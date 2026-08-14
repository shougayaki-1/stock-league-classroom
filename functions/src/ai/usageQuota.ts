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
