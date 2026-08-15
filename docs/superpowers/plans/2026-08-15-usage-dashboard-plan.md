# 利用状況ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 組織の利用状況(今月/累積のlessonRun件数、現在の同時実施数と上限、AI利用枠の日次/月次消費状況と上限)を教師が閲覧できるダッシュボードを追加する。

**Architecture:** 新規Callable `getOrgUsageDashboardCallable` が既存の3つのデータソース(`lessonRuns`コレクションのクエリ、`organizations/{orgId}/aiUsageCounters`カウンター、`getOrgPlanLimitsWithAdminSdk`の上限値)を読み取り専用で集約して返す。deps注入パターンの純粋ロジック + Admin SDK配線 + Callable + クライアントlib + 新規ページの5層構成。

**Tech Stack:** TypeScript, Firebase Cloud Functions (Callable, region `asia-northeast1`), Firestore Admin SDK, Vitest, React, MUI, react-router。

## Global Constraints

- Callable region は必ず `asia-northeast1`。
- 認可は `requireActiveOrgMember` を必ず経由する(owner/admin限定にはしない — `getOrgPlanLimitsCallable` と同じ、対象組織のアクティブメンバーなら誰でも閲覧可)。
- プラン未設定組織のエラーメッセージは既存の `この組織にはプランが設定されていません` を再利用し、Callable層で `failed-precondition` に変換する。
- 密なシングルライン関数本体という既存のハウススタイルに従う。
- 新しいコメントは「なぜ」が非自明な場合のみ追加する。

---

### Task 1: `usageQuota.ts` から `readAiUsageCount` を切り出してexportする

**Files:**
- Modify: `functions/src/ai/usageQuota.ts:50-76`
- Test: `functions/src/ai/usageQuota.adminSdk.test.ts`

**Interfaces:**
- Consumes: なし(既存ファイルのリファクタリングのみ)
- Produces: `export const readAiUsageCount = (db: FirebaseFirestore.Firestore, orgId: string, key: string): Promise<number>` — Task 3で `getOrgUsageDashboardWithAdminSdk` から再利用する。

- [ ] **Step 1: 現在の `usageQuota.adminSdk.test.ts` がパスすることを確認する(リファクタ前のベースライン)**

Run: `cd functions && npx vitest run src/ai/usageQuota.adminSdk.test.ts`
Expected: 全テストPASS(既存6件)

- [ ] **Step 2: `readAiUsageCount` を切り出すテストを追加する**

`functions/src/ai/usageQuota.adminSdk.test.ts` の最後(87行目、ファイル末尾の `})` の直後)に追記:

```ts
describe('readAiUsageCount', () => {
  beforeEach(() => { documents.clear(); setCalls.length = 0 })

  it('returns 0 when the counter document does not exist', async () => {
    const db = getFirestore()
    await expect(readAiUsageCount(db, 'org-1', '2026-01-01')).resolves.toBe(0)
  })

  it('returns the stored count field', async () => {
    documents.set('organizations/org-1/aiUsageCounters/2026-01-01', { count: 3 })
    const db = getFirestore()
    await expect(readAiUsageCount(db, 'org-1', '2026-01-01')).resolves.toBe(3)
  })
})
```

33行目の import 文 `import { getAiUsageQuotaDepsWithAdminSdk } from './usageQuota'` を以下に置き換える:

```ts
import { getAiUsageQuotaDepsWithAdminSdk, readAiUsageCount } from './usageQuota'
```

`vi.mock('firebase-admin/firestore', ...)` ブロック(25-28行目)の直後(29行目、空行)に、テストから直接 `getFirestore`(モック版)を呼べるようにするimportを追加:

```ts
import { getFirestore } from 'firebase-admin/firestore'
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.adminSdk.test.ts`
Expected: FAIL — `readAiUsageCount is not a function` または同種のimportエラー

- [ ] **Step 4: `usageQuota.ts` をリファクタリングする**

`functions/src/ai/usageQuota.ts` の50-76行目を以下に置き換える:

```ts
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
```

ファイル冒頭のimport行(1行目)を以下に置き換える(`Firestore`型を追加):

```ts
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
```

- [ ] **Step 5: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/ai/usageQuota.adminSdk.test.ts src/ai/usageQuota.test.ts`
Expected: 全テストPASS

- [ ] **Step 6: コミット**

```bash
git add functions/src/ai/usageQuota.ts functions/src/ai/usageQuota.adminSdk.test.ts
git commit -m "refactor: aiUsageCountersの読み取りをreadAiUsageCountとしてexportする"
```

---

### Task 2: 純粋ロジック `buildOrgUsageDashboard` を実装する

**Files:**
- Create: `functions/src/organizations/usageDashboard.ts`
- Test: `functions/src/organizations/usageDashboard.test.ts`

**Interfaces:**
- Consumes: なし(deps経由ですべて注入)
- Produces:
  - `export interface OrgUsageDashboard { lessonRunsThisMonth: number; lessonRunsTotal: number; concurrentActive: number; concurrentLimit: number; aiDailyUsed: number; aiDailyLimit: number; aiMonthlyUsed: number; aiMonthlyLimit: number }`
  - `export interface OrgUsageDashboardDeps { countLessonRunsThisMonth: (orgId: string) => Promise<number>; countLessonRunsTotal: (orgId: string) => Promise<number>; countActiveLessonRuns: (orgId: string) => Promise<number>; getLimits: (orgId: string) => Promise<{ concurrentLessonsAndMarkets: number; aiCreditsPerDay: number; aiCredits: number }>; getAiDailyUsed: (orgId: string) => Promise<number>; getAiMonthlyUsed: (orgId: string) => Promise<number> }`
  - `export const buildOrgUsageDashboard = async (deps: OrgUsageDashboardDeps, input: { orgId: string }): Promise<OrgUsageDashboard>` — Task 4がCallableから呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/usageDashboard.test.ts` を新規作成:

```ts
import { describe, expect, it, vi } from 'vitest'
import { buildOrgUsageDashboard, type OrgUsageDashboardDeps } from './usageDashboard'

const makeDeps = (overrides: Partial<OrgUsageDashboardDeps> = {}): OrgUsageDashboardDeps => ({
  countLessonRunsThisMonth: vi.fn().mockResolvedValue(3),
  countLessonRunsTotal: vi.fn().mockResolvedValue(42),
  countActiveLessonRuns: vi.fn().mockResolvedValue(2),
  getLimits: vi.fn().mockResolvedValue({ concurrentLessonsAndMarkets: 5, aiCreditsPerDay: 10, aiCredits: 100 }),
  getAiDailyUsed: vi.fn().mockResolvedValue(4),
  getAiMonthlyUsed: vi.fn().mockResolvedValue(30),
  ...overrides,
})

describe('buildOrgUsageDashboard', () => {
  it('assembles all fields from the injected deps', async () => {
    const deps = makeDeps()
    await expect(buildOrgUsageDashboard(deps, { orgId: 'org-1' })).resolves.toEqual({
      lessonRunsThisMonth: 3,
      lessonRunsTotal: 42,
      concurrentActive: 2,
      concurrentLimit: 5,
      aiDailyUsed: 4,
      aiDailyLimit: 10,
      aiMonthlyUsed: 30,
      aiMonthlyLimit: 100,
    })
  })

  it('calls every dep with the given orgId', async () => {
    const deps = makeDeps()
    await buildOrgUsageDashboard(deps, { orgId: 'org-9' })
    expect(deps.countLessonRunsThisMonth).toHaveBeenCalledWith('org-9')
    expect(deps.countLessonRunsTotal).toHaveBeenCalledWith('org-9')
    expect(deps.countActiveLessonRuns).toHaveBeenCalledWith('org-9')
    expect(deps.getLimits).toHaveBeenCalledWith('org-9')
    expect(deps.getAiDailyUsed).toHaveBeenCalledWith('org-9')
    expect(deps.getAiMonthlyUsed).toHaveBeenCalledWith('org-9')
  })

  it('propagates errors from getLimits (e.g. missing plan)', async () => {
    const deps = makeDeps({ getLimits: vi.fn().mockRejectedValue(new Error('この組織にはプランが設定されていません')) })
    await expect(buildOrgUsageDashboard(deps, { orgId: 'org-1' })).rejects.toThrow('この組織にはプランが設定されていません')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/usageDashboard.test.ts`
Expected: FAIL — `Cannot find module './usageDashboard'`

- [ ] **Step 3: 最小実装を書く**

`functions/src/organizations/usageDashboard.ts` を新規作成:

```ts
export interface OrgUsageDashboard {
  lessonRunsThisMonth: number
  lessonRunsTotal: number
  concurrentActive: number
  concurrentLimit: number
  aiDailyUsed: number
  aiDailyLimit: number
  aiMonthlyUsed: number
  aiMonthlyLimit: number
}

export interface OrgUsageDashboardDeps {
  countLessonRunsThisMonth: (orgId: string) => Promise<number>
  countLessonRunsTotal: (orgId: string) => Promise<number>
  countActiveLessonRuns: (orgId: string) => Promise<number>
  getLimits: (orgId: string) => Promise<{ concurrentLessonsAndMarkets: number; aiCreditsPerDay: number; aiCredits: number }>
  getAiDailyUsed: (orgId: string) => Promise<number>
  getAiMonthlyUsed: (orgId: string) => Promise<number>
}

export const buildOrgUsageDashboard = async (deps: OrgUsageDashboardDeps, input: { orgId: string }): Promise<OrgUsageDashboard> => {
  const [lessonRunsThisMonth, lessonRunsTotal, concurrentActive, limits, aiDailyUsed, aiMonthlyUsed] = await Promise.all([
    deps.countLessonRunsThisMonth(input.orgId),
    deps.countLessonRunsTotal(input.orgId),
    deps.countActiveLessonRuns(input.orgId),
    deps.getLimits(input.orgId),
    deps.getAiDailyUsed(input.orgId),
    deps.getAiMonthlyUsed(input.orgId),
  ])
  return {
    lessonRunsThisMonth,
    lessonRunsTotal,
    concurrentActive,
    concurrentLimit: limits.concurrentLessonsAndMarkets,
    aiDailyUsed,
    aiDailyLimit: limits.aiCreditsPerDay,
    aiMonthlyUsed,
    aiMonthlyLimit: limits.aiCredits,
  }
}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/organizations/usageDashboard.test.ts`
Expected: 全テストPASS(3件)

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/usageDashboard.ts functions/src/organizations/usageDashboard.test.ts
git commit -m "feat: 利用状況ダッシュボードの純粋ロジックbuildOrgUsageDashboardを追加する"
```

---

### Task 3: Admin SDK配線 `getOrgUsageDashboardWithAdminSdk` を実装する

**Files:**
- Modify: `functions/src/organizations/usageDashboard.ts`
- Test: `functions/src/organizations/usageDashboard.adminSdk.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_LESSON_RUN_STATUSES`(`./planLimits`)、`getOrgPlanLimitsWithAdminSdk`(`./planLimits`)、`readAiUsageCount`・`dailyKey`・`monthlyKey`(`../ai/usageQuota`、Task 1で `readAiUsageCount` をexport済み)、`buildOrgUsageDashboard`(Task 2)
- Produces: `export const getOrgUsageDashboardWithAdminSdk = (orgId: string): Promise<OrgUsageDashboard>` — Task 4がCallableから呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/usageDashboard.adminSdk.test.ts` を新規作成:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const collectionQueries: Array<{ path: string; wheres: unknown[][] }> = []
const queryResults = new Map<string, DocumentData[]>()

const buildQuery = (path: string, wheres: unknown[][]) => ({
  where: (...args: unknown[]) => buildQuery(path, [...wheres, args]),
  get: async () => {
    collectionQueries.push({ path, wheres })
    return { size: (queryResults.get(path) ?? []).length, docs: (queryResults.get(path) ?? []).map((data) => ({ data: () => data })) }
  },
})

const doc = (path: string) => ({
  get: async () => (documents.has(path) ? { exists: true, get: (field: string) => documents.get(path)?.[field] } : { exists: false, get: () => undefined }),
})

const collection = (path: string) => buildQuery(path, [])

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc, collection }) }))
vi.mock('./planLimits', () => ({
  ACTIVE_LESSON_RUN_STATUSES: ['DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'REFLECTION'],
  getOrgPlanLimitsWithAdminSdk: vi.fn(),
}))

import { getOrgPlanLimitsWithAdminSdk } from './planLimits'
import { getOrgUsageDashboardWithAdminSdk } from './usageDashboard'

const nowMillis = () => Date.parse('2026-08-15T02:00:00Z') // JST 2026-08-15T11:00:00

describe('getOrgUsageDashboardWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); collectionQueries.length = 0; queryResults.clear(); vi.clearAllMocks() })

  it('assembles counts and limits for the given org', async () => {
    queryResults.set('lessonRuns', [{}, {}, {}])
    documents.set('organizations/org-1/aiUsageCounters/2026-08-15', { count: 4 })
    documents.set('organizations/org-1/aiUsageCounters/2026-08', { count: 30 })
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 5, participants: 1, teacherSeats: 1, aiCredits: 100, aiCreditsPerDay: 10,
      templateStorage: 1, resultRetentionDays: 1, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })

    const result = await getOrgUsageDashboardWithAdminSdk('org-1', nowMillis)

    expect(result).toEqual({
      lessonRunsThisMonth: 3,
      lessonRunsTotal: 3,
      concurrentActive: 3,
      concurrentLimit: 5,
      aiDailyUsed: 4,
      aiDailyLimit: 10,
      aiMonthlyUsed: 30,
      aiMonthlyLimit: 100,
    })
    expect(collectionQueries.filter((q) => q.path === 'lessonRuns')).toHaveLength(3)
  })

  it('propagates a missing-plan error from getOrgPlanLimitsWithAdminSdk', async () => {
    queryResults.set('lessonRuns', [])
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockRejectedValueOnce(new Error('この組織にはプランが設定されていません'))
    await expect(getOrgUsageDashboardWithAdminSdk('org-1', nowMillis)).rejects.toThrow('この組織にはプランが設定されていません')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/usageDashboard.adminSdk.test.ts`
Expected: FAIL — `getOrgUsageDashboardWithAdminSdk is not exported`

- [ ] **Step 3: 実装する**

`functions/src/organizations/usageDashboard.ts` の末尾に追記(冒頭のimportも下記の通り追加):

ファイル冒頭に以下のimportを追加:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { ACTIVE_LESSON_RUN_STATUSES, getOrgPlanLimitsWithAdminSdk } from './planLimits'
import { dailyKey, monthlyKey, readAiUsageCount } from '../ai/usageQuota'
```

ファイル末尾に追記:

```ts
const jstMonthStartFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' })

/** JST基準の今月初(00:00)のUTCミリ秒。 */
const jstMonthStartMillis = (nowMillisValue: number): number => {
  const [year, month] = jstMonthStartFormatter.format(new Date(nowMillisValue)).split('-').map(Number)
  return Date.parse(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`)
}

/** Production wiring: Firestore Admin SDK。 */
export const getOrgUsageDashboardWithAdminSdk = (orgId: string, nowMillis: () => number = Date.now): Promise<OrgUsageDashboard> => {
  const db = getFirestore()
  const lessonRuns = db.collection('lessonRuns')
  return buildOrgUsageDashboard({
    countLessonRunsTotal: async (id) => (await lessonRuns.where('orgId', '==', id).get()).size,
    countLessonRunsThisMonth: async (id) => {
      const monthStart = jstMonthStartMillis(nowMillis())
      return (await lessonRuns.where('orgId', '==', id).where('createdAt', '>=', new Date(monthStart)).get()).size
    },
    countActiveLessonRuns: async (id) => (await lessonRuns.where('orgId', '==', id).where('status', 'in', ACTIVE_LESSON_RUN_STATUSES).get()).size,
    getLimits: async (id) => {
      const limits = await getOrgPlanLimitsWithAdminSdk(id)
      return { concurrentLessonsAndMarkets: limits.concurrentLessonsAndMarkets, aiCreditsPerDay: limits.aiCreditsPerDay, aiCredits: limits.aiCredits }
    },
    getAiDailyUsed: (id) => readAiUsageCount(db, id, dailyKey(nowMillis())),
    getAiMonthlyUsed: (id) => readAiUsageCount(db, id, monthlyKey(nowMillis())),
  }, { orgId })
}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/organizations/usageDashboard.adminSdk.test.ts src/organizations/usageDashboard.test.ts`
Expected: 全テストPASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/usageDashboard.ts functions/src/organizations/usageDashboard.adminSdk.test.ts
git commit -m "feat: 利用状況ダッシュボードのAdmin SDK配線を実装する"
```

---

### Task 4: Callable `getOrgUsageDashboardCallable` を追加する

**Files:**
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/organizations/onCall.test.ts`

**Interfaces:**
- Consumes: `getOrgUsageDashboardWithAdminSdk`(Task 3)、`requireActiveOrgMember`(`./authorization`)、`isCallerTeacher`
- Produces: `export const getOrgUsageDashboardCallable` — フロントエンドが `httpsCallable(functions, 'getOrgUsageDashboardCallable')` で呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/onCall.test.ts` の7行目 `import` ブロックに `getOrgUsageDashboardCallable` を追加:

```ts
import {
  acceptInvitationCallable,
  changeOrgMemberRoleCallable,
  createInvitationCallable,
  createSchoolOrgCallable,
  getOrgPlanLimitsCallable,
  getOrgUsageDashboardCallable,
  isCallerTeacher,
  listOrgInvitationsCallable,
  listOrgMembersCallable,
  listMyInvitationsCallable,
  revokeInvitationCallable,
  suspendOrgMemberCallable,
  createParentOrgCallable,
  linkSchoolToParentOrgCallable,
  listChildSchoolsCallable,
  unlinkSchoolFromParentOrgCallable,
} from './onCall'
```

29行目 `import { getOrgPlanLimitsWithAdminSdk } from './planLimits'` の直後に追加:

```ts
import { getOrgUsageDashboardWithAdminSdk } from './usageDashboard'
```

`vi.mock('./planLimits', ...)` の近くに新しいmockブロックを追加(ファイル内で `vi.mock('./planLimits'` を検索し、その直後に):

```ts
vi.mock('./usageDashboard', () => ({ getOrgUsageDashboardWithAdminSdk: vi.fn() }))
```

`describe('getOrgPlanLimitsCallable', ...)` ブロック(193-230行目)の直後に新しい `describe` ブロックを追加:

```ts
describe('getOrgUsageDashboardCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects unauthenticated requests', async () => {
    const request = { auth: undefined, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgUsageDashboardCallable.run(request)).rejects.toThrow('unauthenticated')
  })

  it('requires an active org member', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgUsageDashboardCallable.run(request)).rejects.toThrow('permission-denied')
  })

  it('returns the assembled usage dashboard for an active member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getOrgUsageDashboardWithAdminSdk).mockResolvedValueOnce({
      lessonRunsThisMonth: 3, lessonRunsTotal: 42, concurrentActive: 2, concurrentLimit: 5,
      aiDailyUsed: 4, aiDailyLimit: 10, aiMonthlyUsed: 30, aiMonthlyLimit: 100,
    })
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgUsageDashboardCallable.run(request)).resolves.toMatchObject({ lessonRunsTotal: 42 })
    expect(getOrgUsageDashboardWithAdminSdk).toHaveBeenCalledWith('org-1')
  })

  it('translates a missing plan into a failed-precondition error', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getOrgUsageDashboardWithAdminSdk).mockRejectedValueOnce(new Error('この組織にはプランが設定されていません'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgUsageDashboardCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: FAIL — `getOrgUsageDashboardCallable is not exported from './onCall'`

- [ ] **Step 3: `onCall.ts` にCallableを実装する**

`functions/src/organizations/onCall.ts` の10行目 `import { getOrgPlanLimitsWithAdminSdk } from './planLimits'` の直後に追加:

```ts
import { getOrgUsageDashboardWithAdminSdk } from './usageDashboard'
```

`getOrgPlanLimitsCallable` の定義の直後(ファイル内で検索して該当箇所を特定)に追加:

```ts
interface GetOrgUsageDashboardRequest { orgId?: unknown }

export const getOrgUsageDashboardCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as GetOrgUsageDashboardRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  try {
    return await getOrgUsageDashboardWithAdminSdk(data.orgId)
  } catch (error) {
    if (error instanceof Error && error.message === 'この組織にはプランが設定されていません') {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
  }
})
```

- [ ] **Step 4: `index.ts` にexportを追加する**

`functions/src/index.ts` の `getOrgPlanLimitsCallable,` の行(23行目付近)の直後に追加:

```ts
  getOrgUsageDashboardCallable,
```

- [ ] **Step 5: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: 全テストPASS

- [ ] **Step 6: functions全体のテストとtscを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 7: コミット**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts
git commit -m "feat: getOrgUsageDashboardCallableを追加する"
```

---

### Task 5: クライアントlib・ページ・ルーティングを実装する

**Files:**
- Create: `src/lib/organizations/usageDashboard.ts`
- Create: `src/components/teacher/organizations/UsageDashboardPage.tsx`
- Create: `src/components/teacher/organizations/UsageDashboardPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`

**Interfaces:**
- Consumes: Callable `getOrgUsageDashboardCallable`(Task 4)、`FirebaseServices`・`TemplateRouteGuard`(`src/App.tsx` 既存)
- Produces: ルート `/teacher/organizations/:orgId/usage-dashboard`

- [ ] **Step 1: クライアントlibを書く**

`src/lib/organizations/usageDashboard.ts` を新規作成:

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgUsageDashboard {
  lessonRunsThisMonth: number
  lessonRunsTotal: number
  concurrentActive: number
  concurrentLimit: number
  aiDailyUsed: number
  aiDailyLimit: number
  aiMonthlyUsed: number
  aiMonthlyLimit: number
}

export interface GetOrgUsageDashboardInput { orgId: string }

export const getOrgUsageDashboard = async (functions: Functions, input: GetOrgUsageDashboardInput): Promise<OrgUsageDashboard> =>
  (await httpsCallable<GetOrgUsageDashboardInput, OrgUsageDashboard>(functions, 'getOrgUsageDashboardCallable')(input)).data
```

- [ ] **Step 2: ページコンポーネントの失敗するテストを書く**

`src/components/teacher/organizations/UsageDashboardPage.test.tsx` を新規作成:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsageDashboardPage } from './UsageDashboardPage'
import type { OrgUsageDashboard } from '../../../lib/organizations/usageDashboard'

const data: OrgUsageDashboard = {
  lessonRunsThisMonth: 3, lessonRunsTotal: 42, concurrentActive: 2, concurrentLimit: 5,
  aiDailyUsed: 4, aiDailyLimit: 10, aiMonthlyUsed: 30, aiMonthlyLimit: 100,
}

describe('UsageDashboardPage', () => {
  it('shows a loading indicator when data is not yet loaded', () => {
    render(<UsageDashboardPage data={undefined} error={undefined} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows an error message when loading failed', () => {
    render(<UsageDashboardPage data={undefined} error="failed" />)
    expect(screen.getByText('読み込みに失敗しました')).toBeInTheDocument()
  })

  it('renders lesson run counts, concurrent usage, and AI quota usage', () => {
    render(<UsageDashboardPage data={data} error={undefined} />)
    expect(screen.getByText(/今月.*3件/)).toBeInTheDocument()
    expect(screen.getByText(/累積.*42件/)).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 5/)).toBeInTheDocument()
    expect(screen.getByText(/4 \/ 10/)).toBeInTheDocument()
    expect(screen.getByText(/30 \/ 100/)).toBeInTheDocument()
  })

  it('highlights concurrent usage when at the limit', () => {
    render(<UsageDashboardPage data={{ ...data, concurrentActive: 5, concurrentLimit: 5 }} error={undefined} />)
    expect(screen.getByText('上限に達しています')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/organizations/UsageDashboardPage.test.tsx`
Expected: FAIL — `Cannot find module './UsageDashboardPage'`

- [ ] **Step 4: ページコンポーネントを実装する**

`src/components/teacher/organizations/UsageDashboardPage.tsx` を新規作成:

```tsx
import { Alert, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material'
import type { OrgUsageDashboard } from '../../../lib/organizations/usageDashboard'

export interface UsageDashboardPageProps {
  data: OrgUsageDashboard | undefined
  error: string | undefined
}

export function UsageDashboardPage({ data, error }: UsageDashboardPageProps) {
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">利用状況ダッシュボード</Typography>
      <Card>
        <CardContent>
          <Typography variant="subtitle1">授業実施件数</Typography>
          <Typography variant="body2">今月: {data.lessonRunsThisMonth}件</Typography>
          <Typography variant="body2">累積: {data.lessonRunsTotal}件</Typography>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="subtitle1">同時実施数</Typography>
          <Typography variant="body2">{data.concurrentActive} / {data.concurrentLimit}</Typography>
          {data.concurrentActive >= data.concurrentLimit && <Alert severity="warning">上限に達しています</Alert>}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="subtitle1">AI利用枠</Typography>
          <Typography variant="body2">本日: {data.aiDailyUsed} / {data.aiDailyLimit}</Typography>
          {data.aiDailyUsed >= data.aiDailyLimit && <Alert severity="warning">本日の上限に達しています</Alert>}
          <Typography variant="body2">今月: {data.aiMonthlyUsed} / {data.aiMonthlyLimit}</Typography>
          {data.aiMonthlyUsed >= data.aiMonthlyLimit && <Alert severity="warning">今月の上限に達しています</Alert>}
        </CardContent>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 5: テストを実行してパスを確認する**

Run: `npx vitest run src/components/teacher/organizations/UsageDashboardPage.test.tsx`
Expected: 全テストPASS(5件)

- [ ] **Step 6: `App.tsx` にルートを追加する**

`src/App.tsx` の45行目 `import { getOrgPlanLimits, type PlanLimitsResult } from './lib/organizations/planLimits'` の直後に追加:

```ts
import { getOrgUsageDashboard, type OrgUsageDashboard } from './lib/organizations/usageDashboard'
```

40行目 `import { PlanLimitsPage } from './components/teacher/organizations/PlanLimitsPage'` の直後に追加:

```ts
import { UsageDashboardPage } from './components/teacher/organizations/UsageDashboardPage'
```

`function PlanLimitsRoute(...)` の定義の直前(585行目の直前)に、新しいシンプルなRouteコンポーネントを追加:

```tsx
function UsageDashboardRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [data, setData] = useState<OrgUsageDashboard>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    setError(undefined)
    getOrgUsageDashboard(services.functions, { orgId })
      .then((result) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError('failed') })
    return () => { cancelled = true }
  }, [services, orgId])
  return <UsageDashboardPage data={data} error={error} />
}

```

833行目 `<Route path="/teacher/organizations/:orgId/plan-limits" ... />` の直後に追加:

```tsx
  <Route path="/teacher/organizations/:orgId/usage-dashboard" element={enabled && services ? <TemplateRouteGuard services={services}><UsageDashboardRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

- [ ] **Step 7: `SchoolOrgSettingsPage.tsx` にリンクを追加する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx` の42行目 `<Link to={`/teacher/organizations/${orgId}/plan-limits`}>利用枠を確認</Link>` の直後に追加:

```tsx
      <Link to={`/teacher/organizations/${orgId}/usage-dashboard`}>利用状況ダッシュボードを見る</Link>
```

`SchoolOrgSettingsPage.test.tsx` に既存の「利用枠を確認」リンクの存在を検証するテストがあれば、その近くに以下を追加(既存テストファイルを確認し、`describe`ブロック内の適切な箇所に1件追加):

```tsx
  it('links to the usage dashboard page', () => {
    render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} />)
    expect(screen.getByRole('link', { name: '利用状況ダッシュボードを見る' })).toHaveAttribute('href', '/teacher/organizations/org-1/usage-dashboard')
  })
```

- [ ] **Step 8: フロントエンド全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/lib/organizations/usageDashboard.ts src/components/teacher/organizations/UsageDashboardPage.tsx src/components/teacher/organizations/UsageDashboardPage.test.tsx src/App.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "feat: 利用状況ダッシュボードのUIとルーティングを追加する"
```
