import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getOrgPlanLimitsWithAdminSdk } from '../organizations/planLimits'

export interface AiUsageQuotaDeps {
  isKillSwitchEnabled: () => Promise<boolean>
  getLimits: (orgId: string) => Promise<{ daily: number; monthly: number }>
  getDailyCount: (orgId: string) => Promise<number>
  getMonthlyCount: (orgId: string) => Promise<number>
  incrementDailyCount: (orgId: string) => Promise<void>
  incrementMonthlyCount: (orgId: string) => Promise<void>
}

export class AiKillSwitchEnabledError extends Error {
  constructor() { super('AI機能は現在停止中です。') }
}

export type AiQuotaPeriod = 'DAILY' | 'MONTHLY'

export class AiQuotaExceededError extends Error {
  readonly period: AiQuotaPeriod
  constructor(period: AiQuotaPeriod) {
    super(period === 'DAILY' ? '本日のAI利用上限に達しました' : '今月のAI利用上限に達しました')
    this.period = period
  }
}

/** 日次を先に確認し、日次が上限内の場合のみ月次を確認する(両方超過時は日次のエラーを返す)。 */
export const checkAiQuota = async (deps: AiUsageQuotaDeps, input: { orgId: string }): Promise<void> => {
  if (await deps.isKillSwitchEnabled()) throw new AiKillSwitchEnabledError()
  const [limits, dailyCount] = await Promise.all([deps.getLimits(input.orgId), deps.getDailyCount(input.orgId)])
  if (dailyCount >= limits.daily) throw new AiQuotaExceededError('DAILY')
  const monthlyCount = await deps.getMonthlyCount(input.orgId)
  if (monthlyCount >= limits.monthly) throw new AiQuotaExceededError('MONTHLY')
}

/** 成功呼び出し後にのみ呼ぶ。失敗呼び出しは枠を消費しない。 */
export const consumeAiQuota = async (deps: AiUsageQuotaDeps, input: { orgId: string }): Promise<void> => {
  await Promise.all([deps.incrementDailyCount(input.orgId), deps.incrementMonthlyCount(input.orgId)])
}

const jstDateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })

/** JST基準の日付キー(YYYY-MM-DD)。organizations/{orgId}/aiUsageCounters のドキュメントIDに使う。 */
export const dailyKey = (millis: number): string => jstDateFormatter.format(new Date(millis))

/** JST基準の月キー(YYYY-MM)。dailyKeyの先頭7文字と一致する。 */
export const monthlyKey = (millis: number): string => dailyKey(millis).slice(0, 7)

/** Production wiring: Firestore Admin SDK + 既存の getOrgPlanLimitsWithAdminSdk。 */
export const getAiUsageQuotaDepsWithAdminSdk = (nowMillis: () => number = Date.now): AiUsageQuotaDeps => {
  const db = getFirestore()
  const counterDoc = (orgId: string, key: string) => db.doc(`organizations/${orgId}/aiUsageCounters/${key}`)
  return {
    isKillSwitchEnabled: async () => {
      const snap = await db.doc('systemConfig/aiKillSwitch').get()
      return snap.exists && snap.get('enabled') === true
    },
    getLimits: async (orgId) => {
      const limits = await getOrgPlanLimitsWithAdminSdk(orgId)
      // Firestore の planDefinitions ドキュメントに aiCreditsPerDay/aiCredits が
      // 欠落している場合(型だけ更新されデータ未整備等)、undefined を「上限なし」と
      // 誤解釈して不正に無制限化しないよう、フェイルクローズドで 0 にフォールバックする。
      const daily = Number.isFinite(limits.aiCreditsPerDay) ? limits.aiCreditsPerDay : 0
      const monthly = Number.isFinite(limits.aiCredits) ? limits.aiCredits : 0
      return { daily, monthly }
    },
    getDailyCount: (orgId) => readAiUsageCount(db, orgId, dailyKey(nowMillis())),
    getMonthlyCount: (orgId) => readAiUsageCount(db, orgId, monthlyKey(nowMillis())),
    incrementDailyCount: async (orgId) => { await counterDoc(orgId, dailyKey(nowMillis())).set({ count: FieldValue.increment(1) }, { merge: true }) },
    incrementMonthlyCount: async (orgId) => { await counterDoc(orgId, monthlyKey(nowMillis())).set({ count: FieldValue.increment(1) }, { merge: true }) },
  }
}

/** organizations/{orgId}/aiUsageCounters/{key} の count フィールドを読む(未作成なら0)。ダッシュボード集計からも再利用する。 */
export const readAiUsageCount = async (db: Firestore, orgId: string, key: string): Promise<number> => {
  const snap = await db.doc(`organizations/${orgId}/aiUsageCounters/${key}`).get()
  return snap.exists ? ((snap.get('count') as number | undefined) ?? 0) : 0
}
