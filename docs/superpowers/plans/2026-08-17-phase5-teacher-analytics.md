# Phase 5: 教師分析画面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/teacher/lessons/:runId/analytics` を `DeferredDataNotice` から実際の `LessonAnalyticsPage` に接続する。

**Architecture:** 集計ロジック `buildLessonAnalytics`（[functions/src/lessonRuns/analytics/buildAnalytics.ts](../../../functions/src/lessonRuns/analytics/buildAnalytics.ts)）は純粋関数として完成済みだが、これをFirestoreの実データに繋ぐCallableが一つも存在しない。新規Callable `getLessonAnalyticsCallable` を追加し、`events`/`responses`/（最新の結果に紐づく）`surveyResponses`/`participants`/`teams` をFirestoreから取得して `buildLessonAnalytics` に渡し、教師の画面にそのまま描画できる形（`displayName` 解決済みの個人行、チーム名一覧）に整形して返す。

Phase 4（結果生成）と異なり、分析は「教師が明示的に生成する」操作を必要としない — `buildLessonAnalytics` はイベント・回答が0件でも `null` を返して優雅に扱う設計になっているため、画面を開くたびにその場で計算するだけで良い。ただし振り返りアンケート（`surveyResponses`）は特定の `results/{resultId}` のサブコレクションに保存される設計になっているため、Phase 4で教師が「結果を生成」していないと（そして生徒がアンケートに回答していないと）分析画面のアンケート由来の指標（判断変更・理解度・予想精度）は常に「データなし」になる — これはバグではなく、実際にまだ何もデータが無いことを正しく表している。

認可は既存の `VIEW_RESULTS` アクション（`lessonControlPermissions` で `PRIMARY`/`ASSISTANT`/`VIEWER` 全ロールに許可済み — 分析は読み取り専用操作なのでこれで適切）をそのまま使う。新しいアクションの追加は不要。

**Tech Stack:** TypeScript, Firebase Admin SDK / Callable Functions, React + MUI, Vitest

## Global Constraints

- 生徒個人を特定できる情報（`displayName` など）を返すCallableは教師専用（`loadAuthorizedRun` でロールチェック済み）に限定する — 生徒側のCallableには一切追加しない
- サーバー側で `LessonAnalytics`（`buildLessonAnalytics` の出力そのまま）と、フロントエンドの `LessonAnalyticsAggregateView`（`rationaleInformationCounts`/`predictionAccuracyAverage` を含まない狭い部分集合）の変換は、Task 3のフロントエンド側コンテナで行う — Callableの戻り値は完全な `LessonAnalyticsAggregate` を返し、UI表示に必要な絞り込みはUI層の責務とする
- 各タスクの最後に `npm run typecheck`, `npm run lint`, 該当テストを実行する

---

## Task 1: バックエンド — `getLessonAnalyticsCallable`

**Files:**
- Create: `functions/src/lessonRuns/analytics/onCall.ts`
- Create: `functions/src/lessonRuns/analytics/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `buildLessonAnalytics`（既存, `./buildAnalytics.ts`）, `loadAuthorizedRun`（既存, Phase 4でexport済み, `../lifecycle/onCall.ts`）
- Produces: `getLessonAnalyticsCallable`。Task 2（クライアントラッパー）がこのCallable名を呼ぶ

- [ ] **Step 1: Write the failing tests**

```ts
// functions/src/lessonRuns/analytics/onCall.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { getLessonAnalyticsCallable } from './onCall'

const docGetMock = vi.fn()
const collectionQueryResults = new Map<string, unknown>()
const makeCollectionStub = (path: string) => ({
  get: () => Promise.resolve(collectionQueryResults.get(path) ?? { docs: [] }),
  orderBy: () => makeCollectionStub(path),
  limit: () => makeCollectionStub(path),
})
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({ get: docGetMock }),
    collection: (path: string) => makeCollectionStub(path),
  }),
}))
vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
  data: () => fields,
})

const makeRequest = (uid = 'teacher-a'): CallableRequest =>
  ({ auth: { uid, token: {} }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as unknown as CallableRequest)

describe('getLessonAnalyticsCallable', () => {
  beforeEach(() => {
    docGetMock.mockReset()
    collectionQueryResults.clear()
  })

  it('rejects a caller with no role on this lessonRun', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(getLessonAnalyticsCallable.run(makeRequest())).rejects.toThrow('この操作を行う権限がありません。')
  })

  it('grants a VIEWER role (read-only analytics) and returns computed analytics with resolved display names/team names', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, {
      orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' }, templateSnapshot: { title: '株式投資シミュレーション' },
    }))
    collectionQueryResults.set('lessonRuns/run-1/participants', {
      docs: [
        { data: () => ({ id: 'p-1', displayName: '山田太郎', teamId: 'team-a' }) },
        { data: () => ({ id: 'p-2', displayName: '鈴木花子', teamId: 'team-a' }) },
      ],
    })
    collectionQueryResults.set('lessonRuns/run-1/teams', {
      docs: [{ id: 'team-a', data: () => ({ displayName: 'Aチーム' }) }],
    })
    collectionQueryResults.set('lessonRuns/run-1/events', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/responses', {
      docs: [{ data: () => ({ id: 'r-1', participantId: 'p-1', teamId: 'team-a', status: 'CONFIRMED', rationaleInformationIds: ['info-1'] }) }],
    })
    collectionQueryResults.set('lessonRuns/run-1/results', { docs: [] })

    const response = await getLessonAnalyticsCallable.run(makeRequest())
    expect(response.data).toEqual(expect.objectContaining({
      lessonRunId: 'run-1',
      lessonTitle: '株式投資シミュレーション',
      totalParticipantCount: 2,
      teams: [{ teamId: 'team-a', teamName: 'Aチーム' }],
    }))
    const data = response.data as { individualRows: Array<{ participantId: string; displayName: string }> }
    expect(data.individualRows).toEqual([
      expect.objectContaining({ participantId: 'p-1', displayName: '山田太郎' }),
    ])
  })

  it('reads surveyResponses from the most recently generated result, when one exists', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    collectionQueryResults.set('lessonRuns/run-1/participants', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/teams', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/events', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/responses', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/results', { docs: [{ id: 'result-1', data: () => ({ id: 'result-1' }) }] })
    collectionQueryResults.set('lessonRuns/run-1/results/result-1/surveyResponses', {
      docs: [{ data: () => ({ id: 'sr-1', participantId: 'p-1', answers: { COMPREHENSION: 4 } }) }],
    })

    const response = await getLessonAnalyticsCallable.run(makeRequest())
    const data = response.data as { aggregate: { comprehensionAverage: number | null } }
    expect(data.aggregate.comprehensionAverage).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=functions -- src/lessonRuns/analytics/onCall.test.ts`
Expected: FAIL — `Cannot find module './onCall'`

- [ ] **Step 3: Write the implementation**

```ts
// functions/src/lessonRuns/analytics/onCall.ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { loadAuthorizedRun } from '../lifecycle/onCall'
import { buildLessonAnalytics, type AnalyticsEvent, type AnalyticsResponse, type AnalyticsSurveyResponse, type LessonAnalyticsAggregate, type LessonAnalyticsIndividualRow } from './buildAnalytics'

interface GetLessonAnalyticsRequest {
  lessonRunId: string
}

export interface GetLessonAnalyticsTeam {
  teamId: string
  teamName: string
}

export interface GetLessonAnalyticsIndividualRow extends LessonAnalyticsIndividualRow {
  displayName: string
}

export interface GetLessonAnalyticsResult {
  lessonRunId: string
  lessonTitle: string
  totalParticipantCount: number
  aggregate: LessonAnalyticsAggregate
  teams: GetLessonAnalyticsTeam[]
  individualRows: GetLessonAnalyticsIndividualRow[]
}

/**
 * Teacher-only, read-only (VIEW_RESULTS — open to PRIMARY/ASSISTANT/VIEWER,
 * matching every role's existing "看板/概要は見られる" tier). Computes
 * analytics live from `events`/`responses`/the latest result's
 * `surveyResponses` on every call — unlike results (Phase 4), there is no
 * separate "generate" step, since `buildLessonAnalytics` already handles
 * zero-data input by returning `null` metrics rather than needing a
 * persisted precomputed snapshot.
 */
export const getLessonAnalyticsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as GetLessonAnalyticsRequest
  if (!data.lessonRunId) throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')
  await loadAuthorizedRun(request, data.lessonRunId, 'VIEW_RESULTS')

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  const lessonTitle = (runSnap.data() as { templateSnapshot?: { title?: string } } | undefined)?.templateSnapshot?.title ?? ''

  const [participantsSnap, teamsSnap, eventsSnap, responsesSnap, resultsSnap] = await Promise.all([
    db.collection(`lessonRuns/${data.lessonRunId}/participants`).get(),
    db.collection(`lessonRuns/${data.lessonRunId}/teams`).get(),
    db.collection(`lessonRuns/${data.lessonRunId}/events`).orderBy('sequence').get(),
    db.collection(`lessonRuns/${data.lessonRunId}/responses`).get(),
    db.collection(`lessonRuns/${data.lessonRunId}/results`).orderBy('generatedAt', 'desc').limit(1).get(),
  ])

  const participants = participantsSnap.docs.map((doc) => doc.data() as { id: string; displayName: string; teamId?: string })
  const displayNameById = new Map(participants.map((participant) => [participant.id, participant.displayName]))
  const teams: GetLessonAnalyticsTeam[] = teamsSnap.docs.map((doc) => ({
    teamId: doc.id,
    teamName: (doc.data() as { displayName?: string }).displayName ?? doc.id,
  }))

  const events: AnalyticsEvent[] = eventsSnap.docs.map((doc) => doc.data() as AnalyticsEvent)
  const responses: AnalyticsResponse[] = responsesSnap.docs.map((doc) => {
    const raw = doc.data() as { id: string; participantId?: string; teamId?: string; status: string; rationaleInformationIds?: string[] }
    return { id: raw.id, participantId: raw.participantId, teamId: raw.teamId, status: raw.status, rationaleInformationIds: raw.rationaleInformationIds ?? [] }
  })

  let surveys: AnalyticsSurveyResponse[] = []
  if (!resultsSnap.empty) {
    const resultId = resultsSnap.docs[0].id
    const surveysSnap = await db.collection(`lessonRuns/${data.lessonRunId}/results/${resultId}/surveyResponses`).get()
    surveys = surveysSnap.docs.map((doc) => doc.data() as AnalyticsSurveyResponse)
  }

  const analytics = buildLessonAnalytics({ lessonRunId: data.lessonRunId, events, responses, surveys })

  return {
    lessonRunId: data.lessonRunId,
    lessonTitle,
    totalParticipantCount: participants.length,
    aggregate: analytics.aggregate,
    teams,
    individualRows: analytics.individualRows.map((row) => ({
      ...row,
      displayName: displayNameById.get(row.participantId) ?? row.participantId,
    })),
  } satisfies GetLessonAnalyticsResult
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=functions -- src/lessonRuns/analytics/onCall.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 5: Export from `functions/src/index.ts`**

[functions/src/index.ts:58](../../../functions/src/index.ts:58)（Phase 4で追加した `generateLessonResultCallable`/`getMyLessonResultCallable` のexport行）の直後に追加:

```ts
export { getLessonAnalyticsCallable } from './lessonRuns/analytics/onCall'
```

- [ ] **Step 6: Run the functions workspace verify**

Run: `npm run verify --workspace=functions`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add functions/src/lessonRuns/analytics/onCall.ts functions/src/lessonRuns/analytics/onCall.test.ts functions/src/index.ts
git commit -m "feat(functions): add getLessonAnalyticsCallable computing live analytics with resolved display names"
```

---

## Task 2: フロントエンド クライアントラッパー

**Files:**
- Create: `src/lib/lessonRuns/analytics.ts`
- Create: `src/lib/lessonRuns/analytics.test.ts`

**Interfaces:**
- Consumes: `getLessonAnalyticsCallable`（Task 1）
- Produces: `getLessonAnalytics`。Task 3（`TeacherAnalyticsRoute` 配線）がこれを利用する

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/lessonRuns/analytics.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import type { Functions } from 'firebase/functions'
import { getLessonAnalytics } from './analytics'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('getLessonAnalytics', () => {
  it('calls getLessonAnalyticsCallable with the lessonRunId', async () => {
    const responseData = {
      lessonRunId: 'run-1', lessonTitle: '株式投資シミュレーション', totalParticipantCount: 2,
      aggregate: {
        responseCount: 1, confirmedResponseCount: 1, surveyRespondentCount: 0,
        rationaleInformationUsageRate: 1, rationaleInformationCounts: { 'info-1': 1 },
        judgmentChangeCount: null, judgmentChangeRate: null, comprehensionDifficultyCount: null,
        comprehensionAverage: null, predictionAccuracyAverage: null, strugglingParticipantCount: null,
      },
      teams: [{ teamId: 'team-a', teamName: 'Aチーム' }],
      individualRows: [],
    }
    const callable = vi.fn().mockResolvedValue({ data: responseData })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const functions = {} as Functions
    const result = await getLessonAnalytics(functions, { lessonRunId: 'run-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getLessonAnalyticsCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
    expect(result).toEqual(responseData)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/lessonRuns/analytics.test.ts`
Expected: FAIL — `Cannot find module './analytics'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/lessonRuns/analytics.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface GetLessonAnalyticsInput {
  lessonRunId: string
}

export interface LessonAnalyticsAggregate {
  responseCount: number
  confirmedResponseCount: number
  surveyRespondentCount: number
  rationaleInformationUsageRate: number | null
  rationaleInformationCounts: Record<string, number>
  judgmentChangeCount: number | null
  judgmentChangeRate: number | null
  comprehensionDifficultyCount: number | null
  comprehensionAverage: number | null
  predictionAccuracyAverage: number | null
  strugglingParticipantCount: number | null
}

export interface LessonAnalyticsIndividualRow {
  participantId: string
  displayName: string
  teamId?: string
  rationaleInformationCount: number
  judgmentChanged: boolean | null
  comprehensionScore: number | null
  resultGapScore: number | null
  struggling: boolean
}

export interface GetLessonAnalyticsResult {
  lessonRunId: string
  lessonTitle: string
  totalParticipantCount: number
  aggregate: LessonAnalyticsAggregate
  teams: { teamId: string; teamName: string }[]
  individualRows: LessonAnalyticsIndividualRow[]
}

export const getLessonAnalytics = async (functions: Functions, input: GetLessonAnalyticsInput): Promise<GetLessonAnalyticsResult> => {
  const callable = httpsCallable<GetLessonAnalyticsInput, GetLessonAnalyticsResult>(functions, 'getLessonAnalyticsCallable')
  const result = await callable(input)
  return result.data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/lessonRuns/analytics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/lessonRuns/analytics.ts src/lib/lessonRuns/analytics.test.ts
git commit -m "feat: add client wrapper for getLessonAnalyticsCallable"
```

---

## Task 3: `TeacherAnalyticsRoute` を実データに接続

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `getLessonAnalytics`（Task 2）, `LessonAnalyticsPage`（既存, `src/components/teacher/LessonAnalyticsPage.tsx`）
- Produces: `/teacher/lessons/:runId/analytics` が実データを表示する

- [ ] **Step 1: Add imports**

`src/App.tsx` の import群に追加:

```ts
import { getLessonAnalytics } from './lib/lessonRuns/analytics'
import { LessonAnalyticsPage } from './components/teacher/LessonAnalyticsPage'
```

- [ ] **Step 2: Replace `TeacherAnalyticsRoute`'s body**

[src/App.tsx:280-286](../../../src/App.tsx:280)（Phase 4以前の行番号 — `grep -n "function TeacherAnalyticsRoute" src/App.tsx` で現在の行を確認してから編集する）を次のように変更する:

変更前:
```tsx
function TeacherAnalyticsRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useTeacherLessonAccess(runId ?? '', services)
  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/about" />
  return <DeferredDataNotice heading="授業分析" />
}
```

変更後:
```tsx
function TeacherAnalyticsRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useTeacherLessonAccess(runId ?? '', services)
  const [analytics, setAnalytics] = useState<GetLessonAnalyticsResult>()

  useEffect(() => {
    if (access.status !== 'GRANTED' || !runId) return
    getLessonAnalytics(services.functions, { lessonRunId: runId }).then(setAnalytics)
  }, [access.status, runId, services])

  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/about" />
  if (!analytics) return <GuardLoading />

  return <LessonAnalyticsPage
    lessonTitle={analytics.lessonTitle}
    totalParticipantCount={analytics.totalParticipantCount}
    aggregate={{
      responseCount: analytics.aggregate.responseCount,
      confirmedResponseCount: analytics.aggregate.confirmedResponseCount,
      surveyRespondentCount: analytics.aggregate.surveyRespondentCount,
      rationaleInformationUsageRate: analytics.aggregate.rationaleInformationUsageRate,
      judgmentChangeCount: analytics.aggregate.judgmentChangeCount,
      judgmentChangeRate: analytics.aggregate.judgmentChangeRate,
      comprehensionDifficultyCount: analytics.aggregate.comprehensionDifficultyCount,
      comprehensionAverage: analytics.aggregate.comprehensionAverage,
      strugglingParticipantCount: analytics.aggregate.strugglingParticipantCount,
    }}
    teams={analytics.teams.map((team) => ({ teamId: team.teamId, teamName: team.teamName }))}
    individualRows={analytics.individualRows}
  />
}
```

`GetLessonAnalyticsResult` 型のimportを追加する（Task 2で作成した型）:

```ts
import type { GetLessonAnalyticsResult } from './lib/lessonRuns/analytics'
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー（`DeferredDataNotice` は `/lessons/:runId/results`（Phase 4以前の`StudentLessonRoute`削除で既に不要か確認済み）や他のプレースホルダー箇所でまだ使われている可能性があるため、未使用importエラーになった場合のみ削除する）

- [ ] **Step 4: Update `App.test.tsx`**

`src/App.test.tsx` の既存テスト `'grants a teacher analytics route and shows the deferred-data notice (no analytics client wrapper exists yet)'`（`grep -n "no analytics client wrapper exists yet" src/App.test.tsx` で現在の行を確認）を置き換える。`httpsCallableMock` に `'getLessonAnalyticsCallable'` の分岐を追加してから使う:

変更前:
```ts
  it('grants a teacher analytics route and shows the deferred-data notice (no analytics client wrapper exists yet)', async () => {
    window.history.pushState({}, '', '/teacher/lessons/run-1/analytics')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ orgId: 'org-1', teacherRoles: { 'teacher-uid': 'ASSISTANT' } }) })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid' })
    expect(await screen.findByRole('heading', { level: 1, name: '授業分析' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
```

変更後:
```ts
  it('grants a teacher analytics route and renders computed analytics', async () => {
    window.history.pushState({}, '', '/teacher/lessons/run-1/analytics')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ orgId: 'org-1', teacherRoles: { 'teacher-uid': 'ASSISTANT' } }) })
    httpsCallableMock.mockImplementation((_functions: unknown, name: string) => {
      if (name === 'getLessonAnalyticsCallable') {
        return vi.fn().mockResolvedValue({
          data: {
            lessonRunId: 'run-1', lessonTitle: '株式投資シミュレーション', totalParticipantCount: 1,
            aggregate: {
              responseCount: 0, confirmedResponseCount: 0, surveyRespondentCount: 0,
              rationaleInformationUsageRate: null, rationaleInformationCounts: {},
              judgmentChangeCount: null, judgmentChangeRate: null, comprehensionDifficultyCount: null,
              comprehensionAverage: null, predictionAccuracyAverage: null, strugglingParticipantCount: null,
            },
            teams: [], individualRows: [],
          },
        })
      }
      return callableMock
    })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid' })
    expect(await screen.findByRole('heading', { level: 1, name: /株式投資シミュレーション/ })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
```

（`httpsCallableMock.mockImplementation(...)` によるこのテスト内での上書きは、既存の10件以上の他のテスト — 例えば `'starts checkout and redirects to its returned URL'` など — が既に同じパターンをそのまま使っており、後続テストへの影響について特別な後始末をしていない。本タスクもその既存の慣習にそのまま従い、追加の後始末は行わない。）

- [ ] **Step 5: Run the test file**

Run: `npm test -- src/App.test.tsx`
Expected: PASS（全テスト。特に、このテストの後に実行される他のテストが `getLessonAnalyticsCallable` 用のモック上書きの影響を受けていないことを確認する）

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire /teacher/lessons/:runId/analytics to live-computed lesson analytics"
```

---

## Task 4: Phase 5完了確認

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: lint, typecheck, tests, rules, market concurrency, build すべてPASS

- [ ] **Step 2: Manual end-to-end smoke test**

1. `npm run dev` でローカル起動
2. Phase 1〜4のフローで授業を作成・開始し、生徒に何件か回答させ、教師が「結果を生成する」を実行
3. `/teacher/lessons/{runId}/analytics` にアクセスし、根拠利用率・判断変更・理解困難の3枚のカードと、チーム別ドリルダウンが表示されることを確認
4. まだ振り返りアンケートに誰も回答していない場合、判断変更・理解度関連の指標が「データなし」と表示され、`0%`と誤表示されないことを確認

- [ ] **Step 3: Update the roadmap**

[docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md](2026-08-17-production-readiness-roadmap.md) の "Phase 5" セクションに完了マークを付ける。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md
git commit -m "docs: mark Phase 5 complete in production readiness roadmap"
```
