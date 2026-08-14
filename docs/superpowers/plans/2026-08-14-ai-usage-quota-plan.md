# AI利用枠の本運用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI呼び出し(`generateLessonDraftCallable`/`generateTeacherGuidanceCallable`)に、組織単位の日次・月次呼び出し回数上限とグローバル緊急停止(キルスイッチ)を実効的に強制する。

**Architecture:** 新規モジュール`functions/src/ai/usageQuota.ts`に、依存注入可能な純粋ロジック(`checkAiQuota`/`consumeAiQuota`)とFirestore Admin SDK配線(`getAiUsageQuotaDepsWithAdminSdk`)を実装する。上限値は既存`PlanLimits`(月次=`aiCredits`流用、日次=新規`aiCreditsPerDay`)から取得し、消費カウンタは`organizations/{orgId}/aiUsageCounters/{日付|月}`ドキュメントに`FieldValue.increment(1)`で記録する。既存の2つのAI callableへ「キルスイッチ確認→上限事前チェック→LLM呼び出し→成功時のみカウンタ増分」の順序で組み込む。フロントは既存の未配線モジュール`describeError`を使って上限到達時に専用メッセージを表示する。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `firebase-admin/firestore`)、Vitest、React (フロント側3コンポーネント)。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-14-ai-usage-quota-design.md`。矛盾があれば正本を優先する。
- 計測単位は呼び出し回数(トークン数ではない)。
- 上限の粒度は組織単位のみ(教師別上限は対象外)。
- 失敗呼び出しは枠を消費しない(成功呼び出しのみカウント)。
- 上限超過時は`HttpsError('resource-exhausted', ...)`、キルスイッチON時は`HttpsError('unavailable', ...)`を返す(いずれも既存コードの再利用、新規コードを追加しない)。
- 日次判定を先に行い、日次が上限内なら月次を判定する(両方超過時は日次のメッセージを返す)。
- 新規Firestoreコレクション(`aiUsageCounters`・`systemConfig`)はクライアントから直接読み書きできない(`allow read, write: if false`。`systemConfig`のみ`operator()`が書き込み可)。
- 新規のFirestore複合インデックスは不要(すべて既知のドキュメントIDへの直接`get`/`set`)。

---

### Task 1: PlanLimitsに`aiCreditsPerDay`を追加する

**Files:**
- Modify: `functions/src/organizations/planLimits.ts:7-15`(`PlanLimits`インターフェース)
- Modify: `functions/src/organizations/planLimits.test.ts:4-7`(テスト用`limits`フィクスチャ)
- Modify: `src/lib/organizations/planLimits.ts:3-11`(フロント側ミラー型)
- Test: `functions/src/organizations/planLimits.test.ts`

**Interfaces:**
- Produces: `PlanLimits.aiCreditsPerDay: number`(functions側・フロント側の両方の型に追加。後続タスクの`getOrgPlanLimitsWithAdminSdk`が返すオブジェクトにこのフィールドが含まれることを、Task 4のAdminSdk配線が前提とする)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/planLimits.test.ts`の`limits`フィクスチャに`aiCreditsPerDay`を追加せず、まず型エラーを確認する目的で、テストファイル内の`limits`定数を以下に変更する。

```ts
const limits = {
  concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, aiCreditsPerDay: 0,
  templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
}
```

- [ ] **Step 2: 型チェックを実行して失敗を確認する**

Run: `cd functions && npx tsc --noEmit`
Expected: `aiCreditsPerDay`が`PlanLimits`型に存在しないというエラーで失敗する(`limits`オブジェクトが`PlanDefinition['limits']`に代入できない旨のエラー)。

- [ ] **Step 3: `PlanLimits`型に`aiCreditsPerDay`を追加する**

`functions/src/organizations/planLimits.ts`の`PlanLimits`インターフェースを以下に変更する。

```ts
export interface PlanLimits {
  concurrentLessonsAndMarkets: number
  participants: number
  teacherSeats: number
  aiCredits: number
  aiCreditsPerDay: number
  templateStorage: number
  resultRetentionDays: number
  eventExtraCapacity: number
}
```

`src/lib/organizations/planLimits.ts`の`PlanLimits`インターフェースにも同じフィールドを同じ位置に追加する。

- [ ] **Step 4: 型チェックとテストを実行して成功を確認する**

Run: `cd functions && npx tsc --noEmit && npx vitest run src/organizations/planLimits.test.ts`
Expected: 型エラーなし、既存4件のテストがすべてPASS。

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/planLimits.ts functions/src/organizations/planLimits.test.ts src/lib/organizations/planLimits.ts
git commit -m "feat: PlanLimitsに日次AI利用枠フィールドを追加する"
```

---

### Task 2: AI利用枠の判定ロジック(`checkAiQuota`/`consumeAiQuota`)を実装する

**Files:**
- Create: `functions/src/ai/usageQuota.ts`
- Test: `functions/src/ai/usageQuota.test.ts`

**Interfaces:**
- Consumes: なし(このタスクは純粋ロジックのみ。Firestoreに依存しない)
- Produces:
  - `interface AiUsageQuotaDeps { isKillSwitchEnabled(): Promise<boolean>; getLimits(orgId: string): Promise<{ daily: number; monthly: number }>; getDailyCount(orgId: string): Promise<number>; getMonthlyCount(orgId: string): Promise<number>; incrementDailyCount(orgId: string): Promise<void>; incrementMonthlyCount(orgId: string): Promise<void> }`
  - `class AiKillSwitchEnabledError extends Error`
  - `class AiQuotaExceededError extends Error { readonly period: 'DAILY' | 'MONTHLY' }`
  - `checkAiQuota(deps: AiUsageQuotaDeps, input: { orgId: string }): Promise<void>` — 超過時は上記エラーをthrowし、超過が無ければ何もしない。
  - `consumeAiQuota(deps: AiUsageQuotaDeps, input: { orgId: string }): Promise<void>` — 日次・月次カウンタを両方インクリメントする。
  - Task 4・Task 5がこれらの型・関数名をそのまま利用する。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/usageQuota.test.ts`を新規作成する。

```ts
import { describe, expect, it, vi } from 'vitest'
import { AiKillSwitchEnabledError, AiQuotaExceededError, checkAiQuota, consumeAiQuota, type AiUsageQuotaDeps } from './usageQuota'

const baseDeps = (overrides: Partial<AiUsageQuotaDeps> = {}): AiUsageQuotaDeps => ({
  isKillSwitchEnabled: async () => false,
  getLimits: async () => ({ daily: 10, monthly: 100 }),
  getDailyCount: async () => 0,
  getMonthlyCount: async () => 0,
  incrementDailyCount: vi.fn(async () => {}),
  incrementMonthlyCount: vi.fn(async () => {}),
  ...overrides,
})

describe('checkAiQuota', () => {
  it('passes when the kill switch is off and both counts are under their limits', async () => {
    await expect(checkAiQuota(baseDeps(), { orgId: 'org-1' })).resolves.toBeUndefined()
  })

  it('throws AiKillSwitchEnabledError when the kill switch is on, without checking limits', async () => {
    const getLimits = vi.fn()
    await expect(checkAiQuota(baseDeps({ isKillSwitchEnabled: async () => true, getLimits }), { orgId: 'org-1' })).rejects.toBeInstanceOf(AiKillSwitchEnabledError)
    expect(getLimits).not.toHaveBeenCalled()
  })

  it('throws a DAILY AiQuotaExceededError when the daily count has reached the daily limit', async () => {
    const getMonthlyCount = vi.fn()
    const error = await checkAiQuota(baseDeps({ getDailyCount: async () => 10, getMonthlyCount }), { orgId: 'org-1' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiQuotaExceededError)
    expect((error as AiQuotaExceededError).period).toBe('DAILY')
    expect(getMonthlyCount).not.toHaveBeenCalled()
  })

  it('throws a MONTHLY AiQuotaExceededError when only the monthly count has reached its limit', async () => {
    const error = await checkAiQuota(baseDeps({ getMonthlyCount: async () => 100 }), { orgId: 'org-1' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiQuotaExceededError)
    expect((error as AiQuotaExceededError).period).toBe('MONTHLY')
  })
})

describe('consumeAiQuota', () => {
  it('increments both the daily and monthly counters', async () => {
    const incrementDailyCount = vi.fn(async () => {})
    const incrementMonthlyCount = vi.fn(async () => {})
    await consumeAiQuota(baseDeps({ incrementDailyCount, incrementMonthlyCount }), { orgId: 'org-1' })
    expect(incrementDailyCount).toHaveBeenCalledWith('org-1')
    expect(incrementMonthlyCount).toHaveBeenCalledWith('org-1')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.test.ts`
Expected: FAIL(`./usageQuota`モジュールが存在しない)。

- [ ] **Step 3: 最小限の実装を書く**

`functions/src/ai/usageQuota.ts`を新規作成する。

```ts
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
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.test.ts`
Expected: 5件すべてPASS。

- [ ] **Step 5: コミット**

```bash
git add functions/src/ai/usageQuota.ts functions/src/ai/usageQuota.test.ts
git commit -m "feat: AI利用枠の判定ロジックを実装する"
```

---

### Task 3: JST日付キーのヘルパーを実装する

**Files:**
- Modify: `functions/src/ai/usageQuota.ts`(Task 2で作成したファイルに追記)
- Test: `functions/src/ai/usageQuota.test.ts`(Task 2で作成したファイルに追記)

**Interfaces:**
- Consumes: なし
- Produces: `dailyKey(millis: number): string`(`YYYY-MM-DD`、JST基準)、`monthlyKey(millis: number): string`(`YYYY-MM`、JST基準)。Task 4のAdminSdk配線がこれらをFirestoreドキュメントID生成に使う。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/usageQuota.test.ts`の末尾に追記する。

```ts
import { dailyKey, monthlyKey } from './usageQuota'

describe('dailyKey', () => {
  it('formats a UTC instant as its JST calendar date', () => {
    // 2026-01-01T15:30:00Z は JST で 2026-01-02T00:30:00
    expect(dailyKey(Date.parse('2026-01-01T15:30:00Z'))).toBe('2026-01-02')
  })
  it('stays on the same JST day for a morning UTC instant', () => {
    // 2026-01-01T02:00:00Z は JST で 2026-01-01T11:00:00
    expect(dailyKey(Date.parse('2026-01-01T02:00:00Z'))).toBe('2026-01-01')
  })
})

describe('monthlyKey', () => {
  it('formats a UTC instant as its JST calendar month', () => {
    expect(monthlyKey(Date.parse('2026-01-31T15:30:00Z'))).toBe('2026-02')
  })
})
```

(このimport文はファイル先頭の既存import群と重複しないよう、Step 1では既存の`import { AiKillSwitchEnabledError, ...`の行に`dailyKey, monthlyKey`を追加する形にまとめる。)

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.test.ts`
Expected: FAIL(`dailyKey`/`monthlyKey`が存在しない)。

- [ ] **Step 3: 実装を追加する**

`functions/src/ai/usageQuota.ts`の末尾に追記する。

```ts
const jstDateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })

/** JST基準の日付キー(YYYY-MM-DD)。organizations/{orgId}/aiUsageCounters のドキュメントIDに使う。 */
export const dailyKey = (millis: number): string => jstDateFormatter.format(new Date(millis))

/** JST基準の月キー(YYYY-MM)。dailyKeyの先頭7文字と一致する。 */
export const monthlyKey = (millis: number): string => dailyKey(millis).slice(0, 7)
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.test.ts`
Expected: 8件すべてPASS(Task 2の5件 + 本タスクの3件)。

- [ ] **Step 5: コミット**

```bash
git add functions/src/ai/usageQuota.ts functions/src/ai/usageQuota.test.ts
git commit -m "feat: JST基準の日次・月次キー生成を追加する"
```

---

### Task 4: Firestore Admin SDK配線(`getAiUsageQuotaDepsWithAdminSdk`)を実装する

**Files:**
- Modify: `functions/src/ai/usageQuota.ts`(追記)
- Test: `functions/src/ai/usageQuota.adminSdk.test.ts`(新規)

**Interfaces:**
- Consumes: `functions/src/organizations/planLimits.ts`の`getOrgPlanLimitsWithAdminSdk(orgId: string): Promise<PlanLimitsResult>`(`aiCredits`・`aiCreditsPerDay`フィールドを読む。Task 1で追加済み)
- Produces: `getAiUsageQuotaDepsWithAdminSdk(nowMillis?: () => number): AiUsageQuotaDeps`。Task 5がこれを`checkAiQuota`/`consumeAiQuota`とともに使う。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/usageQuota.adminSdk.test.ts`を新規作成する。

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const setCalls: Array<{ path: string; data: DocumentData }> = []

const doc = (path: string) => ({
  get: async () => {
    const data = documents.get(path)
    return { exists: data !== undefined, get: (field: string) => data?.[field] }
  },
  set: async (data: DocumentData) => {
    setCalls.push({ path, data })
    const existing = documents.get(path) ?? {}
    const merged = { ...existing }
    for (const [key, value] of Object.entries(data)) {
      merged[key] = value === INCREMENT_MARKER ? ((existing[key] as number | undefined) ?? 0) + 1 : value
    }
    documents.set(path, merged)
  },
})

const INCREMENT_MARKER = Symbol('increment')

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: () => INCREMENT_MARKER },
  getFirestore: () => ({ doc }),
}))

vi.mock('../organizations/planLimits', () => ({ getOrgPlanLimitsWithAdminSdk: vi.fn() }))

import { getOrgPlanLimitsWithAdminSdk } from '../organizations/planLimits'
import { getAiUsageQuotaDepsWithAdminSdk } from './usageQuota'

const nowMillis = () => Date.parse('2026-01-01T02:00:00Z') // JST 2026-01-01T11:00:00

describe('getAiUsageQuotaDepsWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); setCalls.length = 0; vi.clearAllMocks() })

  it('reports the kill switch as disabled when the config document does not exist', async () => {
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.isKillSwitchEnabled()).resolves.toBe(false)
  })

  it('reports the kill switch as enabled when the config document says so', async () => {
    documents.set('systemConfig/aiKillSwitch', { enabled: true })
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.isKillSwitchEnabled()).resolves.toBe(true)
  })

  it('reads daily and monthly limits from the org plan limits', async () => {
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 1, participants: 1, teacherSeats: 1, aiCredits: 100, aiCreditsPerDay: 10,
      templateStorage: 1, resultRetentionDays: 1, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.getLimits('org-1')).resolves.toEqual({ daily: 10, monthly: 100 })
  })

  it('returns 0 counts when no counter document exists yet, then increments them', async () => {
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.getDailyCount('org-1')).resolves.toBe(0)
    await expect(deps.getMonthlyCount('org-1')).resolves.toBe(0)

    await deps.incrementDailyCount('org-1')
    await deps.incrementMonthlyCount('org-1')

    await expect(deps.getDailyCount('org-1')).resolves.toBe(1)
    await expect(deps.getMonthlyCount('org-1')).resolves.toBe(1)
    expect(setCalls.map((c) => c.path)).toEqual([
      'organizations/org-1/aiUsageCounters/2026-01-01',
      'organizations/org-1/aiUsageCounters/2026-01',
    ])
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.adminSdk.test.ts`
Expected: FAIL(`getAiUsageQuotaDepsWithAdminSdk`が存在しない)。

- [ ] **Step 3: 実装を追加する**

`functions/src/ai/usageQuota.ts`の先頭に以下のimportを追加する。

```ts
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getOrgPlanLimitsWithAdminSdk } from '../organizations/planLimits'
```

ファイル末尾に追記する。

```ts
/** Production wiring: Firestore Admin SDK + 既存の getOrgPlanLimitsWithAdminSdk。 */
export const getAiUsageQuotaDepsWithAdminSdk = (nowMillis: () => number = Date.now): AiUsageQuotaDeps => {
  const db = getFirestore()
  const counterDoc = (orgId: string, key: string) => db.doc(`organizations/${orgId}/aiUsageCounters/${key}`)
  const readCount = async (orgId: string, key: string): Promise<number> => {
    const snap = await counterDoc(orgId, key).get()
    return snap.exists ? ((snap.get('count') as number | undefined) ?? 0) : 0
  }
  return {
    isKillSwitchEnabled: async () => {
      const snap = await db.doc('systemConfig/aiKillSwitch').get()
      return snap.exists && snap.get('enabled') === true
    },
    getLimits: async (orgId) => {
      const limits = await getOrgPlanLimitsWithAdminSdk(orgId)
      return { daily: limits.aiCreditsPerDay, monthly: limits.aiCredits }
    },
    getDailyCount: (orgId) => readCount(orgId, dailyKey(nowMillis())),
    getMonthlyCount: (orgId) => readCount(orgId, monthlyKey(nowMillis())),
    incrementDailyCount: async (orgId) => { await counterDoc(orgId, dailyKey(nowMillis())).set({ count: FieldValue.increment(1) }, { merge: true }) },
    incrementMonthlyCount: async (orgId) => { await counterDoc(orgId, monthlyKey(nowMillis())).set({ count: FieldValue.increment(1) }, { merge: true }) },
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.adminSdk.test.ts src/ai/usageQuota.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add functions/src/ai/usageQuota.ts functions/src/ai/usageQuota.adminSdk.test.ts
git commit -m "feat: AI利用枠のFirestore Admin SDK配線を実装する"
```

---

### Task 5: AI callableに利用枠チェックを組み込む

**Files:**
- Modify: `functions/src/ai/onCall.ts`(全体)
- Modify: `functions/src/ai/onCall.test.ts`(全体)

**Interfaces:**
- Consumes: Task 2〜4で作った`checkAiQuota`・`consumeAiQuota`・`getAiUsageQuotaDepsWithAdminSdk`・`AiKillSwitchEnabledError`・`AiQuotaExceededError`(`functions/src/ai/usageQuota.ts`からimport)
- Produces: 変更なし(既存の`generateLessonDraftCallable`/`generateTeacherGuidanceCallable`のエクスポート名・シグネチャは維持)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/onCall.test.ts`を以下の内容に**全体を置き換える**。既存の単純な`doc`/`collection`汎用モックでは、組織ドキュメント・利用枠チェック・使用ログの3種類を区別できないため、`usageQuota`モジュールをモックする方式に変更する。

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { generateLessonDraftCallable, generateTeacherGuidanceCallable } from './onCall'
import { AiKillSwitchEnabledError, AiQuotaExceededError, checkAiQuota, consumeAiQuota } from './usageQuota'

const orgGet = vi.fn()
const usageLogAdd = vi.fn()
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: orgGet }), collection: () => ({ add: usageLogAdd }) }) }))
vi.mock('./usageQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./usageQuota')>()
  return { ...actual, checkAiQuota: vi.fn(), consumeAiQuota: vi.fn(), getAiUsageQuotaDepsWithAdminSdk: () => ({}) }
})

const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']
const request = (auth = teacher, data: Record<string, unknown> = {}): CallableRequest => ({ auth, data: { theme: 'テーマ', mainObjective: '目標', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD', ...data }, rawRequest: {} } as unknown as CallableRequest)
const guidanceRequest = (auth = teacher, data: Record<string, unknown> = { topic: 'トピック' }): CallableRequest => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

describe('generateLessonDraftCallable', () => {
  beforeEach(() => { vi.clearAllMocks(); usageLogAdd.mockResolvedValue(undefined); vi.mocked(checkAiQuota).mockResolvedValue(undefined); vi.mocked(consumeAiQuota).mockResolvedValue(undefined) })

  it('rejects unauthenticated callers', async () => { await expect(generateLessonDraftCallable.run(request(null as never))).rejects.toMatchObject({ code: 'unauthenticated' }) })

  it('rejects while the organization has AI disabled without logging a usage attempt or checking quota', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => false })
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(usageLogAdd).not.toHaveBeenCalled()
    expect(checkAiQuota).not.toHaveBeenCalled()
  })

  it('rejects with resource-exhausted when the daily or monthly quota is exceeded, without calling the provider', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    vi.mocked(checkAiQuota).mockRejectedValueOnce(new AiQuotaExceededError('DAILY'))
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'resource-exhausted', message: '本日のAI利用上限に達しました' })
    expect(usageLogAdd).not.toHaveBeenCalled()
  })

  it('rejects with unavailable when the kill switch is enabled', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    vi.mocked(checkAiQuota).mockRejectedValueOnce(new AiKillSwitchEnabledError())
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'unavailable' })
    expect(usageLogAdd).not.toHaveBeenCalled()
  })

  it('logs provider failure, returns a safe unavailable error, and does not consume quota', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'unavailable' })
    expect(usageLogAdd).toHaveBeenCalledWith(expect.objectContaining({ feature: 'LESSON_DRAFT', succeeded: false }))
    expect(consumeAiQuota).not.toHaveBeenCalled()
  })

  it('accepts optional material texts', async () => { orgGet.mockResolvedValueOnce({ exists: true, get: () => true }); await expect(generateLessonDraftCallable.run(request(teacher, { materialTexts: ['資料の内容'] }))).rejects.toMatchObject({ code: 'unavailable' }) })
})

describe('generateTeacherGuidanceCallable', () => {
  beforeEach(() => { vi.clearAllMocks(); usageLogAdd.mockResolvedValue(undefined); vi.mocked(checkAiQuota).mockResolvedValue(undefined); vi.mocked(consumeAiQuota).mockResolvedValue(undefined) })

  it('rejects with resource-exhausted when the monthly quota is exceeded', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    vi.mocked(checkAiQuota).mockRejectedValueOnce(new AiQuotaExceededError('MONTHLY'))
    await expect(generateTeacherGuidanceCallable.run(guidanceRequest())).rejects.toMatchObject({ code: 'resource-exhausted', message: '今月のAI利用上限に達しました' })
    expect(usageLogAdd).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: FAIL(新しく追加した「resource-exhausted」「kill switch」ケースが現行実装には存在せず、`checkAiQuota`/`consumeAiQuota`が呼ばれないためモックの呼び出し検証が失敗する)。

- [ ] **Step 3: `onCall.ts`を書き換える**

`functions/src/ai/onCall.ts`を以下の内容に**全体を置き換える**。

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { personalOrgId } from '../lib/personalOrgId'
import { isCallerTeacher } from '../organizations/onCall'
import { unconfiguredLlmProvider } from './llmProvider'
import { assertNoForbiddenFields } from './piiFilter'
import { buildLessonDraftPrompt, parseLessonDraftResponse, type LessonDraftPromptInput } from './lessonDraftPrompt'
import { buildTeacherGuidancePrompt, parseTeacherGuidanceResponse, type TeacherGuidancePromptInput } from './teacherGuidancePrompt'
import { AiKillSwitchEnabledError, AiQuotaExceededError, checkAiQuota, consumeAiQuota, getAiUsageQuotaDepsWithAdminSdk } from './usageQuota'

interface GenerateLessonDraftRequest { theme?: unknown; mainObjective?: unknown; subject?: unknown; difficulty?: unknown; materialTexts?: unknown }
const isValidRequest = (data: GenerateLessonDraftRequest): data is LessonDraftPromptInput => typeof data.theme === 'string' && typeof data.mainObjective === 'string' && (data.subject === 'SOCIAL_STUDIES' || data.subject === 'HOME_ECONOMICS') && (data.difficulty === 'BASIC' || data.difficulty === 'STANDARD' || data.difficulty === 'ADVANCED') && (data.materialTexts === undefined || (Array.isArray(data.materialTexts) && data.materialTexts.every((item) => typeof item === 'string')))

/** キルスイッチ・利用枠超過は HttpsError へ変換し、成功呼び出し時のみ枠を消費する。 */
const asQuotaHttpsError = (error: unknown): HttpsError => {
  if (error instanceof AiKillSwitchEnabledError) return new HttpsError('unavailable', error.message)
  if (error instanceof AiQuotaExceededError) return new HttpsError('resource-exhausted', error.message)
  throw error
}

/** Returns an unpersisted draft suggestion; the existing overview confirmation is the only template write path. */
export const generateLessonDraftCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const teacherUid = request.auth.uid
  const data = request.data as GenerateLessonDraftRequest
  if (!isValidRequest(data)) throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const db = getFirestore()
  const orgId = personalOrgId(teacherUid)
  const org = await db.doc(`organizations/${orgId}`).get()
  if (!org.exists || org.get('aiEnabled') !== true) throw new HttpsError('failed-precondition', 'AI機能はこの組織では有効化されていません。')
  if (data.materialTexts?.length && org.get('materialsUploadEnabled') !== true) throw new HttpsError('failed-precondition', '資料アップロード機能はこの組織では有効化されていません。')
  const quotaDeps = getAiUsageQuotaDepsWithAdminSdk()
  try { await checkAiQuota(quotaDeps, { orgId }) } catch (error) { throw asQuotaHttpsError(error) }
  const logUsage = (succeeded: boolean) => db.collection(`organizations/${orgId}/aiUsageLog`).add({ orgId, teacherUid, feature: 'LESSON_DRAFT', succeeded, createdAt: new Date() })
  try {
    assertNoForbiddenFields(data as unknown as Record<string, unknown>)
    const draft = parseLessonDraftResponse(await unconfiguredLlmProvider.generateText(buildLessonDraftPrompt(data)))
    await Promise.all([logUsage(true), consumeAiQuota(quotaDeps, { orgId })])
    return draft
  } catch {
    await logUsage(false)
    throw new HttpsError('unavailable', 'AI提案の生成に失敗しました。固定の案をご利用ください。')
  }
})

export const generateTeacherGuidanceCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as { topic?: unknown }
  if (typeof data.topic !== 'string' || !data.topic) throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const teacherUid = request.auth.uid; const orgId = personalOrgId(teacherUid); const db = getFirestore(); const org = await db.doc(`organizations/${orgId}`).get()
  if (!org.exists || org.get('aiEnabled') !== true) throw new HttpsError('failed-precondition', 'AI機能はこの組織では有効化されていません。')
  const quotaDeps = getAiUsageQuotaDepsWithAdminSdk()
  try { await checkAiQuota(quotaDeps, { orgId }) } catch (error) { throw asQuotaHttpsError(error) }
  const logUsage = (succeeded: boolean) => db.collection(`organizations/${orgId}/aiUsageLog`).add({ orgId, teacherUid, feature: 'TEACHER_GUIDANCE', succeeded, createdAt: new Date() })
  try { assertNoForbiddenFields(data as Record<string, unknown>); const result = parseTeacherGuidanceResponse(await unconfiguredLlmProvider.generateText(buildTeacherGuidancePrompt(data as TeacherGuidancePromptInput))); await Promise.all([logUsage(true), consumeAiQuota(quotaDeps, { orgId })]); return result } catch { await logUsage(false); throw new HttpsError('unavailable', 'AI下書きの生成に失敗しました。手動で入力してください。') }
})
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS(既存の他モジュールに影響がないことを確認)。

- [ ] **Step 6: コミット**

```bash
git add functions/src/ai/onCall.ts functions/src/ai/onCall.test.ts
git commit -m "feat: AI呼び出しに利用枠チェックとキルスイッチを組み込む"
```

---

### Task 6: Firestoreセキュリティルールを追加する

**Files:**
- Modify: `firestore.rules:74`(`aiUsageLog`ルールの直後に追記)
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `organizations/{orgId}/aiUsageCounters/{counterId}`・`systemConfig/{documentId}`の読み書き制御(Functions Admin SDKはルールをバイパスするため、Task 4の実装には影響しない)

- [ ] **Step 1: 失敗するテストを書く**

`test/firestore.rules.test.ts`の`describe('planDefinitions/{planId}', ...)`ブロックの直後に以下を追記する(ファイル内の既存`import`・`environment`セットアップ・`teacherToken`/`operatorToken`定数はそのまま利用する)。

```ts
describe('organizations/{orgId}/aiUsageCounters/{counterId}', () => {
  it('declares an explicit deny rule for the AI usage counters subcollection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/organizations\/\{orgId\}\/aiUsageCounters\/\{counterId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const counter = doc(context.firestore(), 'organizations/org-1/aiUsageCounters/2026-01-01')
    await assertFails(getDoc(counter))
    await assertFails(setDoc(counter, { count: 1 }))
  })
})

describe('systemConfig/{documentId}', () => {
  it('denies reads and non-operator writes, but allows an operator to write', async () => {
    const teacherFirestore = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const operatorFirestore = environment.authenticatedContext('operator-a', operatorToken).firestore()
    await assertFails(getDoc(doc(teacherFirestore, 'systemConfig/aiKillSwitch')))
    await assertFails(setDoc(doc(teacherFirestore, 'systemConfig/aiKillSwitch'), { enabled: true }))
    await assertSucceeds(setDoc(doc(operatorFirestore, 'systemConfig/aiKillSwitch'), { enabled: true }))
  })
})
```

- [ ] **Step 2: ルールテストを実行して失敗を確認する**

Run: `npm run test:rules -- test/firestore.rules.test.ts`
Expected: FAIL(`aiUsageCounters`・`systemConfig`にマッチするルールがまだ存在せず、Firestoreのデフォルト拒否によりdeny系は通るが、`declares an explicit deny rule`のテキストマッチが失敗する。また`systemConfig`は明示ルールが無いため`operator`書き込みも失敗する)。

- [ ] **Step 3: `firestore.rules`にルールを追加する**

`firestore.rules`の74行目`match /organizations/{orgId}/aiUsageLog/{logId} { allow read, write: if false; }`の直後に追記する。

```
    match /organizations/{orgId}/aiUsageCounters/{counterId} { allow read, write: if false; }

    match /systemConfig/{documentId} {
      allow get: if false;
      allow list: if false;
      allow write: if operator();
    }
```

- [ ] **Step 4: ルールテストを実行して成功を確認する**

Run: `npm run test:rules -- test/firestore.rules.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: コミット**

```bash
git add firestore.rules test/firestore.rules.test.ts
git commit -m "feat: AI利用枠カウンタとシステム設定のFirestoreルールを追加する"
```

---

### Task 7: フロントのエラー表示に上限到達メッセージを配線する

**Files:**
- Modify: `src/components/teacher/TeacherGuidanceDialog.tsx`
- Modify: `src/components/teacher/templates/TemplateOverviewPage.tsx`
- Modify: `src/components/teacher/templates/TemplateEditorPage.tsx`
- Test: `src/components/teacher/templates/TemplateOverviewPage.test.tsx`(追記)
- Test: `src/components/teacher/templates/TemplateEditorPage.test.tsx`(追記)

**Interfaces:**
- Consumes: 既存の`src/lib/monitoring/describeError.ts`の`describeError(error: unknown, fallback: string): string`(変更なし、現状どこからも呼ばれていない)

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateOverviewPage.test.tsx`の`describe('TemplateOverviewPage', ...)`ブロック内、既存の`'keeps fixed tiers available when AI generation fails'`テストの直後に追記する。

```tsx
  it('shows a quota message when AI generation is rejected with resource-exhausted', async () => {
    vi.mocked(generateLessonDraft).mockRejectedValueOnce({ code: 'resource-exhausted', message: '本日のAI利用上限に達しました' })
    render(<TemplateOverviewPage {...props} aiEnabled />)
    fireEvent.click(screen.getByRole('button', { name: /AI提案/ }))
    expect(await screen.findByText(/上限/)).toBeInTheDocument()
  })
```

`src/components/teacher/templates/TemplateEditorPage.test.tsx`の`describe('TemplateEditorPage', ...)`ブロック内、既存の`'updates editable title and description from selected materials without saving'`テストの直後に追記する。

```tsx
  it('shows a quota message when regeneration is rejected with resource-exhausted', async () => {
    vi.mocked(listMaterials).mockResolvedValue([{ id: 'm1', fileName: '資料.pdf', text: '内容' }])
    vi.mocked(generateLessonDraft).mockRejectedValueOnce({ code: 'resource-exhausted', message: '今月のAI利用上限に達しました' })
    render(<TemplateEditorPage {...props} aiEnabled materialsUploadEnabled onSaveDraft={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: '資料' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '資料.pdf' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '資料.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: '資料を使ってAI提案を更新' }))
    expect(await screen.findByText(/上限/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: FAIL(現状の固定文言には「上限」という語が含まれない)。

- [ ] **Step 3: `TemplateOverviewPage.tsx`を修正する**

`import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'`の直後に以下を追加する。

```tsx
import { describeError } from '../../../lib/monitoring/describeError'
```

既存の`catch { setAiError('AI提案の生成に失敗しました。固定の案をご利用ください。') }`を以下に置き換える。

```tsx
    } catch (error) { setAiError(describeError(error, 'AI提案の生成に失敗しました。固定の案をご利用ください。')) } finally { setAiLoading(false) }
```

- [ ] **Step 4: `TemplateEditorPage.tsx`を修正する**

`import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'`の直後に以下を追加する。

```tsx
import { describeError } from '../../../lib/monitoring/describeError'
```

既存の`regenerate`内`catch { setAiError('AI提案の生成に失敗しました。') }`を以下に置き換える。

```tsx
catch (error) { setAiError(describeError(error, 'AI提案の生成に失敗しました。')) }
```

- [ ] **Step 5: `TeacherGuidanceDialog.tsx`を修正する**

`import { generateTeacherGuidance } from '../../lib/ai/generateTeacherGuidance'`の直後に以下を追加する。

```tsx
import { describeError } from '../../lib/monitoring/describeError'
```

既存の`catch { setError('AI下書きに失敗しました。手動で入力してください。') }`を以下に置き換える。

```tsx
catch (error) { setError(describeError(error, 'AI下書きに失敗しました。手動で入力してください。')) }
```

- [ ] **Step 6: テストを実行して成功を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/lib/monitoring/describeError.test.ts`
Expected: 全件PASS(既存の`'keeps fixed tiers available when AI generation fails'`テストは、`new Error('unavailable')`が`code`プロパティを持たないため`describeError`がfallback文言をそのまま返し、引き続きPASSする)。

- [ ] **Step 7: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 8: コミット**

```bash
git add src/components/teacher/TeacherGuidanceDialog.tsx src/components/teacher/templates/TemplateOverviewPage.tsx src/components/teacher/templates/TemplateEditorPage.tsx src/components/teacher/templates/TemplateOverviewPage.test.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx
git commit -m "feat: AI利用上限到達時に専用メッセージを表示する"
```

---

## 運用上の注意(コード変更外)

- 既存の`planDefinitions/{planId}`ドキュメント(Firestore本番データ)に`aiCreditsPerDay`フィールドを追加するデータ移行が必要。本リポジトリにはFirestoreデータのシード/移行スクリプトが存在しないため、Firestoreコンソール等での手動更新を想定する(具体的な数値は運用実績を踏まえて別途決定)。
- `systemConfig/aiKillSwitch`ドキュメントは初回は未作成のままでよい(`isKillSwitchEnabled`は未存在時に`false`を返す)。緊急停止時は`operator`権限を持つアカウントでこのドキュメントに`{ enabled: true }`を書き込む。
