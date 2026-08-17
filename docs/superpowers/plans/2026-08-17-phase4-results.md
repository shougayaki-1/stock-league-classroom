# Phase 4: 結果表示 — 教師による結果生成 + 生徒の結果閲覧 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師が Control Room から「結果を生成する」を実行できるようにし、生徒が `/lessons/:runId/results` で自分自身（または自チーム）の結果を閲覧できるようにする。

**Architecture:** 結果を組み立てて Firestore に保存する `buildAndPersistLessonResult`（[functions/src/lessonRuns/results/buildResults.ts](../../../functions/src/lessonRuns/results/buildResults.ts)）は完成しているが、これを呼び出すコードがコードベース全体に一つも存在しない — 結果は本番で一度も自動生成されていない。ユーザーの判断により、フェーズ遷移マシンを変更する自動生成ではなく、教師が明示的に「結果を生成する」操作を行う設計を採る。したがってこのフェーズはCallableを2つ新規実装する: (1) 教師専用 `generateLessonResultCallable`（`buildAndPersistLessonResultWithAdminSdk` を呼ぶ）、(2) 生徒専用 `getMyLessonResultCallable`（保存済みの結果から呼び出し元の `participantId`/`teamId` に一致する回答だけを絞り込んで返す — Firestoreの `results` コレクション自体は生徒に一切公開しない）。認可は既存の `canControlLesson`/`lessonControlPermissions` 表に `GENERATE_RESULTS` アクションを追加する形で行う（既存の `START_LESSON`/`END_LESSON` 等と同じ表）。

**Tech Stack:** TypeScript, Firebase Admin SDK / Callable Functions, React + MUI, Vitest

## Global Constraints

- 生徒がFirestoreの `results` コレクションに直接アクセスできる経路を一切作らない（`firestore.rules` は変更しない）— 全て Callable 経由でサーバー側フィルタ済みデータのみ返す
- 新しい権限アクション `GENERATE_RESULTS` は既存の `lessonControlActions`/`lessonControlPermissions`/`LessonControlAction` の3箇所（[functions/src/lessonRuns/authorization.ts](../../../functions/src/lessonRuns/authorization.ts)）を同時に更新する — 3箇所のうち1つでも更新漏れがあると型エラーになる設計になっている
- 各タスクの最後に `npm run typecheck`, `npm run lint`, 該当テストを実行する

---

## Task 1: バックエンド認可 — `GENERATE_RESULTS` アクションの追加

**Files:**
- Modify: `functions/src/lessonRuns/authorization.ts`
- Modify: `functions/src/lessonRuns/authorization.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `canControlLesson(role, 'GENERATE_RESULTS')`。Task 2 の `generateLessonResultCallable` がこれを使う

- [ ] **Step 1: Write the failing test**

`functions/src/lessonRuns/authorization.test.ts` に追加する（既存のテストの末尾、または同種の `describe`/`it` ブロックの近くに追加）:

```ts
describe('GENERATE_RESULTS', () => {
  it('allows PRIMARY and ASSISTANT but not VIEWER', () => {
    expect(canControlLesson('PRIMARY', 'GENERATE_RESULTS')).toBe(true)
    expect(canControlLesson('ASSISTANT', 'GENERATE_RESULTS')).toBe(true)
    expect(canControlLesson('VIEWER', 'GENERATE_RESULTS')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=functions -- src/lessonRuns/authorization.test.ts`
Expected: FAIL — TypeScript の時点で `'GENERATE_RESULTS'` が `LessonControlAction` に存在せずコンパイルエラーになる

- [ ] **Step 3: Add the action to the 3 tables**

`functions/src/lessonRuns/authorization.ts` の `LessonControlAction` union（[functions/src/lessonRuns/authorization.ts:25-39](../../../functions/src/lessonRuns/authorization.ts:25)）に追加:

変更前:
```ts
export type LessonControlAction =
  | 'START_LESSON'
  | 'END_LESSON'
  | 'STOP_MARKET'
  | 'CHANGE_SETTINGS'
  | 'TRANSFER_PRIMARY'
  | 'TRANSITION_PHASE'
  | 'PROCESS_ROUND'
  | 'MANAGE_HOUSEHOLD_ASSIGNMENT'
  | 'PUBLISH_NOTICE'
  | 'EXTEND_TIME'
  | 'SUPPORT_STUDENT'
  | 'HANDLE_CONNECTION'
  | 'VIEW_PROGRESS'
  | 'VIEW_RESULTS'
```

変更後:
```ts
export type LessonControlAction =
  | 'START_LESSON'
  | 'END_LESSON'
  | 'STOP_MARKET'
  | 'CHANGE_SETTINGS'
  | 'TRANSFER_PRIMARY'
  | 'TRANSITION_PHASE'
  | 'PROCESS_ROUND'
  | 'MANAGE_HOUSEHOLD_ASSIGNMENT'
  | 'PUBLISH_NOTICE'
  | 'EXTEND_TIME'
  | 'SUPPORT_STUDENT'
  | 'HANDLE_CONNECTION'
  | 'VIEW_PROGRESS'
  | 'VIEW_RESULTS'
  | 'GENERATE_RESULTS'
```

`lessonControlActions` 配列（[functions/src/lessonRuns/authorization.ts:41-56](../../../functions/src/lessonRuns/authorization.ts:41)）の末尾に追加:

変更前:
```ts
  'VIEW_PROGRESS',
  'VIEW_RESULTS',
]
```

変更後:
```ts
  'VIEW_PROGRESS',
  'VIEW_RESULTS',
  'GENERATE_RESULTS',
]
```

`lessonControlPermissions` の `PUBLISH_NOTICE`/`EXTEND_TIME` と同じ「主担当・補助担当ともに可」グループ（[functions/src/lessonRuns/authorization.ts:69-72](../../../functions/src/lessonRuns/authorization.ts:69)）に追加:

変更前:
```ts
  // 主担当・補助担当ともに可
  PUBLISH_NOTICE: ['PRIMARY', 'ASSISTANT'],
  EXTEND_TIME: ['PRIMARY', 'ASSISTANT'],
  SUPPORT_STUDENT: ['PRIMARY', 'ASSISTANT'],
  HANDLE_CONNECTION: ['PRIMARY', 'ASSISTANT'],
```

変更後:
```ts
  // 主担当・補助担当ともに可
  PUBLISH_NOTICE: ['PRIMARY', 'ASSISTANT'],
  EXTEND_TIME: ['PRIMARY', 'ASSISTANT'],
  SUPPORT_STUDENT: ['PRIMARY', 'ASSISTANT'],
  HANDLE_CONNECTION: ['PRIMARY', 'ASSISTANT'],
  GENERATE_RESULTS: ['PRIMARY', 'ASSISTANT'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=functions -- src/lessonRuns/authorization.test.ts`
Expected: PASS

- [ ] **Step 5: Export `loadAuthorizedRun` for reuse**

`functions/src/lessonRuns/lifecycle/onCall.ts` の `loadAuthorizedRun`（[functions/src/lessonRuns/lifecycle/onCall.ts:31](../../../functions/src/lessonRuns/lifecycle/onCall.ts:31)）を、複製せず再利用するため export する:

変更前:
```ts
const loadAuthorizedRun = async (
```

変更後:
```ts
export const loadAuthorizedRun = async (
```

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー

- [ ] **Step 7: Commit**

```bash
git add functions/src/lessonRuns/authorization.ts functions/src/lessonRuns/authorization.test.ts functions/src/lessonRuns/lifecycle/onCall.ts
git commit -m "feat(functions): add GENERATE_RESULTS lesson-control action and export loadAuthorizedRun for reuse"
```

---

## Task 2: バックエンド — `generateLessonResultCallable`/`getMyLessonResultCallable`

**Files:**
- Create: `functions/src/lessonRuns/results/onCall.ts`
- Create: `functions/src/lessonRuns/results/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `buildAndPersistLessonResultWithAdminSdk`（既存, `./buildResults.ts`）, `loadAuthorizedRun`（Task 1でexport済み, `../lifecycle/onCall.ts`）, `LessonResult`/`LessonResultResponseSummary`（既存型, `./buildResults.ts`）
- Produces: `generateLessonResultCallable`, `getMyLessonResultCallable`。Task 3（クライアントラッパー）がこれらのCallable名を呼ぶ

- [ ] **Step 1: Write the failing tests**

```ts
// functions/src/lessonRuns/results/onCall.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { generateLessonResultCallable, getMyLessonResultCallable } from './onCall'
import * as buildResults from './buildResults'

const docGetMock = vi.fn()
const collectionGetMock = vi.fn()
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({ get: docGetMock }),
    collection: () => ({ orderBy: () => ({ limit: () => ({ get: collectionGetMock }) }) }),
  }),
}))
vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./buildResults', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./buildResults')>()
  return { ...actual, buildAndPersistLessonResultWithAdminSdk: vi.fn() }
})

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

describe('generateLessonResultCallable', () => {
  beforeEach(() => {
    docGetMock.mockReset()
    vi.mocked(buildResults.buildAndPersistLessonResultWithAdminSdk).mockReset()
  })

  const makeRequest = (data: Record<string, unknown> = {}, uid = 'teacher-a'): CallableRequest =>
    ({ auth: { uid, token: {} }, data: { lessonRunId: 'run-1', phaseId: 'phase-1', idempotencyKey: 'idem-1', ...data }, rawRequest: {} } as unknown as CallableRequest)

  it('rejects a caller with no role on this lessonRun', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(generateLessonResultCallable.run(makeRequest())).rejects.toThrow('この操作を行う権限がありません。')
  })

  it('rejects a VIEWER role (not authorized to generate results)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(generateLessonResultCallable.run(makeRequest())).rejects.toThrow('この操作を行う権限がありません。')
  })

  it('calls buildAndPersistLessonResultWithAdminSdk for an authorized PRIMARY teacher', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(buildResults.buildAndPersistLessonResultWithAdminSdk).mockResolvedValue({
      resultId: 'result-1', result: { id: 'result-1', lessonRunId: 'run-1', orgId: 'org-1', phaseId: 'phase-1', generatedAt: 'now', responses: [] }, deduplicated: false,
    })
    const response = await generateLessonResultCallable.run(makeRequest())
    expect(response.data).toEqual(expect.objectContaining({ resultId: 'result-1', deduplicated: false }))
    expect(buildResults.buildAndPersistLessonResultWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', orgId: 'org-1', phaseId: 'phase-1', idempotencyKey: 'idem-1', actorId: 'teacher-a',
    }))
  })
})

describe('getMyLessonResultCallable', () => {
  beforeEach(() => {
    docGetMock.mockReset()
    collectionGetMock.mockReset()
  })

  const makeRequest = (uid = 'student-uid'): CallableRequest =>
    ({ auth: { uid, token: {} }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as unknown as CallableRequest)

  it('rejects an unauthenticated caller', async () => {
    await expect(getMyLessonResultCallable.run({ auth: undefined, data: { lessonRunId: 'run-1' }, rawRequest: {} } as unknown as CallableRequest))
      .rejects.toThrow('サインインが必要です。')
  })

  it('rejects a caller with no participant index entry on this lessonRun', async () => {
    docGetMock.mockResolvedValueOnce({ exists: false })
    await expect(getMyLessonResultCallable.run(makeRequest())).rejects.toThrow('このレッスンランに参加していません。')
  })

  it('returns found: false when no result has been generated yet', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ participantId: 'p-1' }) }) // participantsByAuthUid index
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ teamId: 'team-a' }) }) // participants/{id}
    collectionGetMock.mockResolvedValueOnce({ empty: true, docs: [] })
    const response = await getMyLessonResultCallable.run(makeRequest())
    expect(response.data).toEqual({ found: false, lessonRunId: 'run-1', items: [] })
  })

  it('returns only the responses matching the caller\'s own participantId or teamId', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ participantId: 'p-1' }) })
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ teamId: 'team-a' }) })
    collectionGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [{
        data: () => ({
          id: 'result-1', lessonRunId: 'run-1', orgId: 'org-1', phaseId: 'phase-1', generatedAt: '2026-01-01T00:00:00.000Z',
          externalTaskUrl: 'https://example.com/task',
          responses: [
            { responseId: 'r-1', scope: 'participant', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: '選択肢A', confirmedAt: null, decisionExplanation: { whatHappened: 'a', whyItHappened: 'b', alternative: 'c', nextAction: 'd' } },
            { responseId: 'r-2', scope: 'team', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-2', value: 42, confirmedAt: null, decisionExplanation: { whatHappened: 'e', whyItHappened: 'f', alternative: 'g', nextAction: 'h' } },
            { responseId: 'r-3', scope: 'participant', participantId: 'p-2', phaseId: 'phase-1', inputId: 'input-3', value: '他人の回答', confirmedAt: null, decisionExplanation: { whatHappened: '', whyItHappened: '', alternative: '', nextAction: '' } },
          ],
        }),
      }],
    })
    const response = await getMyLessonResultCallable.run(makeRequest())
    expect(response.data).toEqual({
      found: true,
      lessonRunId: 'run-1',
      externalTaskUrl: 'https://example.com/task',
      items: [
        { responseId: 'r-1', scope: 'participant', displayValue: '選択肢A', decisionExplanation: { whatHappened: 'a', whyItHappened: 'b', alternative: 'c', nextAction: 'd' } },
        { responseId: 'r-2', scope: 'team', displayValue: '42', decisionExplanation: { whatHappened: 'e', whyItHappened: 'f', alternative: 'g', nextAction: 'h' } },
      ],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=functions -- src/lessonRuns/results/onCall.test.ts`
Expected: FAIL — `Cannot find module './onCall'`

- [ ] **Step 3: Write the implementation**

```ts
// functions/src/lessonRuns/results/onCall.ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { loadAuthorizedRun } from '../lifecycle/onCall'
import { buildAndPersistLessonResultWithAdminSdk, type LessonResult } from './buildResults'

interface GenerateLessonResultRequest {
  lessonRunId: string
  phaseId: string
  idempotencyKey: string
  externalTaskUrl?: string
  externalResultUrl?: string
}

const translateGenerateResultError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error && error.message === 'Idempotency key payload mismatch') {
    return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/** Teacher-only (PRIMARY/ASSISTANT). Persists a `LessonResult` for the given phase — see buildResults.ts's own JSDoc for why nothing calls this automatically today. */
export const generateLessonResultCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as GenerateLessonResultRequest
  if (!data.lessonRunId || !data.phaseId || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、phaseId、idempotencyKey は必須です。')
  }
  const { orgId } = await loadAuthorizedRun(request, data.lessonRunId, 'GENERATE_RESULTS')
  try {
    return await buildAndPersistLessonResultWithAdminSdk({
      lessonRunId: data.lessonRunId,
      orgId,
      phaseId: data.phaseId,
      externalTaskUrl: data.externalTaskUrl,
      externalResultUrl: data.externalResultUrl,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth!.uid,
    })
  } catch (error) {
    throw translateGenerateResultError(error)
  }
})

/**
 * Same `participantsByAuthUid/{authUid}` index-lookup pattern as
 * `market/onCall.ts`'s `resolveActorParticipantId` — never trusted from
 * client input, resolved server-side from the verified auth uid.
 */
const resolveActorParticipantId = async (lessonRunId: string, authUid: string): Promise<string> => {
  const db = getFirestore()
  const indexSnap = await db.doc(`lessonRuns/${lessonRunId}/participantsByAuthUid/${authUid}`).get()
  if (!indexSnap.exists) throw new HttpsError('failed-precondition', 'このレッスンランに参加していません。')
  const { participantId } = indexSnap.data() as { participantId: string }
  return participantId
}

interface GetMyLessonResultRequest {
  lessonRunId: string
}

export interface GetMyLessonResultItem {
  responseId: string
  scope: 'participant' | 'team'
  displayValue: string
  decisionExplanation: LessonResult['responses'][number]['decisionExplanation']
}

export interface GetMyLessonResultResult {
  found: boolean
  lessonRunId: string
  externalTaskUrl?: string
  externalResultUrl?: string
  items: GetMyLessonResultItem[]
}

const formatDisplayValue = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

/**
 * Student-facing. Reads the most recently generated `LessonResult` for this
 * lessonRun (server-side, Admin SDK — `firestore.rules` keeps `results/`
 * teacher-read-only for the client SDK on purpose) and returns ONLY the
 * responses whose `participantId` matches the caller's own resolved
 * identity, or whose `teamId` matches the caller's own team — never any
 * other participant's or team's response (§23.6 identity protection, same
 * discipline `LessonResultsPage`'s own JSDoc documents on the client side).
 */
export const getMyLessonResultCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as GetMyLessonResultRequest
  if (!data.lessonRunId) throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')

  const db = getFirestore()
  const participantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  const participantSnap = await db.doc(`lessonRuns/${data.lessonRunId}/participants/${participantId}`).get()
  const teamId = participantSnap.exists ? (participantSnap.data() as { teamId?: string }).teamId : undefined

  const resultsSnap = await db.collection(`lessonRuns/${data.lessonRunId}/results`).orderBy('generatedAt', 'desc').limit(1).get()
  if (resultsSnap.empty) return { found: false, lessonRunId: data.lessonRunId, items: [] } satisfies GetMyLessonResultResult

  const result = resultsSnap.docs[0].data() as LessonResult
  const items: GetMyLessonResultItem[] = result.responses
    .filter((response) => response.participantId === participantId || (teamId !== undefined && response.teamId === teamId))
    .map((response) => ({
      responseId: response.responseId,
      scope: response.scope,
      displayValue: formatDisplayValue(response.value),
      decisionExplanation: response.decisionExplanation,
    }))

  return {
    found: true,
    lessonRunId: data.lessonRunId,
    ...(result.externalTaskUrl ? { externalTaskUrl: result.externalTaskUrl } : {}),
    ...(result.externalResultUrl ? { externalResultUrl: result.externalResultUrl } : {}),
    items,
  } satisfies GetMyLessonResultResult
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=functions -- src/lessonRuns/results/onCall.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 5: Export both Callables from `functions/src/index.ts`**

[functions/src/index.ts:57](../../../functions/src/index.ts:57) の直後（`createLessonRunCallable`/`restoreCheckpointCallable` のexport行）に追加:

```ts
export { generateLessonResultCallable, getMyLessonResultCallable } from './lessonRuns/results/onCall'
```

- [ ] **Step 6: Run the functions workspace verify**

Run: `npm run verify --workspace=functions`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add functions/src/lessonRuns/results/onCall.ts functions/src/lessonRuns/results/onCall.test.ts functions/src/index.ts
git commit -m "feat(functions): add generateLessonResultCallable (teacher) and getMyLessonResultCallable (student, identity-filtered)"
```

---

## Task 3: フロントエンド クライアントラッパー

**Files:**
- Create: `src/lib/lessonRuns/results.ts`
- Create: `src/lib/lessonRuns/results.test.ts`

**Interfaces:**
- Consumes: `generateLessonResultCallable`/`getMyLessonResultCallable`（Task 2）
- Produces: `generateLessonResult`/`getMyLessonResult`。Task 4（Control Room配線）と Task 5（生徒結果画面配線）がこれらを利用する

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/lessonRuns/results.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import type { Functions } from 'firebase/functions'
import { generateLessonResult, getMyLessonResult } from './results'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('generateLessonResult', () => {
  it('calls generateLessonResultCallable with the given input', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { resultId: 'result-1', deduplicated: false } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const functions = {} as Functions
    const result = await generateLessonResult(functions, { lessonRunId: 'run-1', phaseId: 'phase-1', idempotencyKey: 'idem-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'generateLessonResultCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', phaseId: 'phase-1', idempotencyKey: 'idem-1' })
    expect(result).toEqual({ resultId: 'result-1', deduplicated: false })
  })
})

describe('getMyLessonResult', () => {
  it('calls getMyLessonResultCallable with the lessonRunId', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { found: true, lessonRunId: 'run-1', items: [] } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const functions = {} as Functions
    const result = await getMyLessonResult(functions, { lessonRunId: 'run-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getMyLessonResultCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
    expect(result).toEqual({ found: true, lessonRunId: 'run-1', items: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/lessonRuns/results.test.ts`
Expected: FAIL — `Cannot find module './results'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/lessonRuns/results.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface GenerateLessonResultInput {
  lessonRunId: string
  phaseId: string
  idempotencyKey: string
  externalTaskUrl?: string
  externalResultUrl?: string
}

export interface GenerateLessonResultResult {
  resultId: string
  deduplicated: boolean
}

export const generateLessonResult = async (functions: Functions, input: GenerateLessonResultInput): Promise<GenerateLessonResultResult> => {
  const callable = httpsCallable<GenerateLessonResultInput, GenerateLessonResultResult>(functions, 'generateLessonResultCallable')
  const result = await callable(input)
  return result.data
}

export interface GetMyLessonResultInput {
  lessonRunId: string
}

export interface GetMyLessonResultItem {
  responseId: string
  scope: 'participant' | 'team'
  displayValue: string
  decisionExplanation: { whatHappened: string; whyItHappened: string; alternative: string; nextAction: string }
}

export interface GetMyLessonResultResult {
  found: boolean
  lessonRunId: string
  externalTaskUrl?: string
  externalResultUrl?: string
  items: GetMyLessonResultItem[]
}

export const getMyLessonResult = async (functions: Functions, input: GetMyLessonResultInput): Promise<GetMyLessonResultResult> => {
  const callable = httpsCallable<GetMyLessonResultInput, GetMyLessonResultResult>(functions, 'getMyLessonResultCallable')
  const result = await callable(input)
  return result.data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/lessonRuns/results.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/lessonRuns/results.ts src/lib/lessonRuns/results.test.ts
git commit -m "feat: add client wrappers for generateLessonResultCallable and getMyLessonResultCallable"
```

---

## Task 4: `LessonControlRoom` に「結果を生成する」ボタンを配線

**Files:**
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `generateLessonResult`（Task 3）
- Produces: `LessonControlRoom` に `onGenerateResults?: () => void`/`generatingResults?: boolean` prop が追加される。`TeacherControlRoute` がこれを実際の呼び出しに接続する

- [ ] **Step 1: Add the failing test to `LessonControlRoom.test.tsx`**

`src/components/teacher/LessonControlRoom.test.tsx` は既に `emitPublic(state)`（部分的なpublic-state更新をマージして流し込むヘルパー、[src/components/teacher/LessonControlRoom.test.tsx:47-51](../../../src/components/teacher/LessonControlRoom.test.tsx:47)）と、`render(<LessonControlRoom ... />)` を直接呼ぶパターンを持っている。同じ書き方で追加する:

```tsx
it('shows a 結果を生成する button in REFLECTION status for PRIMARY and calls onGenerateResults with the current phaseId', async () => {
  const onGenerateResults = vi.fn()
  const user = userEvent.setup()
  render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} onGenerateResults={onGenerateResults} />)
  emitPublic({ status: 'REFLECTION', currentPhaseId: 'phase-3' })

  const button = await screen.findByRole('button', { name: '結果を生成する' })
  await user.click(button)
  expect(onGenerateResults).toHaveBeenCalledWith('phase-3')
})

it('hides the 結果を生成する button for a VIEWER role', () => {
  render(<LessonControlRoom lessonRunId="run-1" role="VIEWER" functions={functions} firestore={firestore} database={database} onGenerateResults={vi.fn()} />)
  emitPublic({ status: 'REFLECTION', currentPhaseId: 'phase-3' })
  expect(screen.queryByRole('button', { name: '結果を生成する' })).not.toBeInTheDocument()
})

it('hides the 結果を生成する button outside REFLECTION status', () => {
  render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} onGenerateResults={vi.fn()} />)
  emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-3' })
  expect(screen.queryByRole('button', { name: '結果を生成する' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/teacher/LessonControlRoom.test.tsx`
Expected: FAIL — ボタンが存在しない

- [ ] **Step 3: Add the prop and button to `LessonControlRoom`**

`LessonControlRoomProps`（[src/components/teacher/LessonControlRoom.tsx:60-83](../../../src/components/teacher/LessonControlRoom.tsx:60)）に追加:

```ts
  /**
   * Invoked when the teacher clicks 結果を生成する (status REFLECTION,
   * GENERATE_RESULTS-authorized roles only). Receives this screen's own
   * `publicState.currentPhaseId` — the caller (TeacherControlRoom's parent)
   * has no other way to learn which phase is currently REFLECTION, since
   * only this component subscribes to `lessonRunPublic`. `null` should not
   * normally happen while `status === 'REFLECTION'`, but the type stays
   * honest about what the subscription can actually report.
   */
  onGenerateResults?: (currentPhaseId: string | null) => void
  generatingResults?: boolean
```

コンポーネント本体で `canGenerateResults` を計算する変数を追加する（`canEndLesson` の定義の近く、[src/components/teacher/LessonControlRoom.tsx:170](../../../src/components/teacher/LessonControlRoom.tsx:170) 付近）:

```ts
  const canGenerateResults = canControlLesson(role, 'GENERATE_RESULTS') && status === 'REFLECTION'
```

「操作」セクションのボタン群（[src/components/teacher/LessonControlRoom.tsx:245-256](../../../src/components/teacher/LessonControlRoom.tsx:245) 付近、`canEndLesson` ボタンの直前）に追加:

```tsx
          {canGenerateResults && onGenerateResults && (
            <Button
              variant="outlined"
              onClick={() => onGenerateResults(publicState?.currentPhaseId ?? null)}
              disabled={generatingResults || !publicState?.currentPhaseId}
              sx={{ minHeight: MIN_TOUCH_TARGET }}
            >
              結果を生成する
            </Button>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/teacher/LessonControlRoom.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire `TeacherControlRoute` in `src/App.tsx`**

`src/App.tsx` の import群に追加:

```ts
import { generateLessonResult } from './lib/lessonRuns/results'
```

`TeacherControlRoute`（`grep -n "function TeacherControlRoute" src/App.tsx` で現在の行番号を確認してから編集する）を変更する。現在の実装は `LessonControlRoom` を単純に返しているだけなので、`generatingResults` の状態管理とハンドラを追加する:

変更前:
```tsx
function TeacherControlRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useTeacherLessonAccess(runId ?? '', services)
  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/about" />
  return <LessonControlRoom
    lessonRunId={runId ?? ''}
    role={access.role ?? 'VIEWER'}
    subject={access.subject}
    homeEconomicsCourseFormat={access.homeEconomicsCourseFormat}
    functions={services.functions}
    firestore={services.firestore}
    database={services.database}
  />
}
```

変更後:
```tsx
function TeacherControlRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useTeacherLessonAccess(runId ?? '', services)
  const [generatingResults, setGeneratingResults] = useState(false)
  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/about" />
  return <LessonControlRoom
    lessonRunId={runId ?? ''}
    role={access.role ?? 'VIEWER'}
    subject={access.subject}
    homeEconomicsCourseFormat={access.homeEconomicsCourseFormat}
    functions={services.functions}
    firestore={services.firestore}
    database={services.database}
    generatingResults={generatingResults}
    onGenerateResults={async (currentPhaseId) => {
      if (!runId || !currentPhaseId) return
      setGeneratingResults(true)
      try {
        await generateLessonResult(services.functions, {
          lessonRunId: runId,
          phaseId: currentPhaseId,
          idempotencyKey: crypto.randomUUID(),
        })
      } finally {
        setGeneratingResults(false)
      }
    }}
  />
}
```

`currentPhaseId` は `LessonControlRoom` が自身の `lessonRunPublic` 購読から渡してくる（Step 3で追加した `onGenerateResults(publicState?.currentPhaseId ?? null)` 呼び出し）。`TeacherControlRoute` 自身は `lessonRunPublic` を購読しないため、この値を他の経路から得ることはできない — `null` の場合は何もしない（ボタン自体もStep 3で `disabled` になっているため通常到達しない）。

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx src/App.tsx
git commit -m "feat: wire a teacher-facing 結果を生成する button into LessonControlRoom during REFLECTION"
```

---

## Task 5: 生徒の結果画面を実データに接続

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `getMyLessonResult`（Task 3）, `LessonResultsPage`（既存, `src/components/student/LessonResultsPage.tsx`）
- Produces: `/lessons/:runId/results` が `DeferredDataNotice` ではなく実際の結果（またはまだ生成されていない旨のメッセージ）を表示する

- [ ] **Step 1: Add the import**

`src/App.tsx` の import群に追加:

```ts
import { getMyLessonResult } from './lib/lessonRuns/results'
import { LessonResultsPage } from './components/student/LessonResultsPage'
```

- [ ] **Step 2: Add a `StudentResultsRoute` component**

`StudentWaitingRoute`（Phase 2で追加済み）の直後に新しい関数を追加する:

```tsx
/**
 * `/lessons/:runId/results` only. `displayName`/`teamName` come from the
 * same live sources `StudentWaitingRoute` uses (location.state / the
 * public-state teams list) rather than being duplicated inside the
 * result-fetch response, which only carries response items.
 */
function StudentResultsRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const location = useLocation()
  const access = useStudentLessonAccess(runId ?? '', services)
  const [publicState, setPublicState] = useState<LessonRunPublicState | null>(null)
  const [myResult, setMyResult] = useState<GetMyLessonResultResult | null>(null)

  useEffect(() => {
    if (!runId) return
    return subscribePublicRun(services.database, runId, setPublicState)
  }, [runId, services])

  useEffect(() => {
    if (access.status !== 'GRANTED' || !runId) return
    getMyLessonResult(services.functions, { lessonRunId: runId }).then(setMyResult)
  }, [access.status, runId, services])

  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/join" />
  if (!publicState || !myResult) return <GuardLoading />

  if (!myResult.found) {
    return (
      <Stack sx={{ width: '100%', maxWidth: 480, p: 4 }} spacing={1}>
        <Typography variant="h6" component="h1">{publicState.title}</Typography>
        <Typography variant="body2">まだ結果が発表されていません。教師の案内をお待ちください。</Typography>
      </Stack>
    )
  }

  const displayName = (location.state as { displayName?: string } | null)?.displayName ?? '(表示名不明)'
  const teamName = access.teamId ? publicState.teams.find((team) => team.teamId === access.teamId)?.displayName : undefined

  return <LessonResultsPage
    lessonTitle={publicState.title}
    displayName={displayName}
    teamName={teamName}
    results={myResult.items.map((item) => ({ responseId: item.responseId, scope: item.scope, displayValue: item.displayValue, decisionExplanation: item.decisionExplanation }))}
    externalTaskUrl={myResult.externalTaskUrl}
    externalResultUrl={myResult.externalResultUrl}
  />
}
```

`GetMyLessonResultResult` 型のimportを追加する（Task 3で作成した型):

```ts
import type { GetMyLessonResultResult } from './lib/lessonRuns/results'
```

- [ ] **Step 3: Wire the route**

`grep -n '"/lessons/:runId/results"' src/App.tsx` で現在の行を確認してから変更する:

変更前:
```tsx
  <Route path="/lessons/:runId/results" element={enabled && services ? <StudentLessonRoute services={services} heading="結果" /> : <Navigate replace to="/about" />} />
```

変更後:
```tsx
  <Route path="/lessons/:runId/results" element={enabled && services ? <StudentResultsRoute services={services} /> : <Navigate replace to="/about" />} />
```

（`StudentLessonRoute` 自体はもう `/waiting`/`/results` のどちらからも使われなくなるため、他に参照が無ければ削除して構わない — `grep -n "StudentLessonRoute" src/App.tsx` で確認し、参照が無くなっていれば関数定義ごと削除して未使用コードを残さないこと。）

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー

- [ ] **Step 5: Update `App.test.tsx`**

`src/App.test.tsx` に `/results` ルートのテストを2件追加する（`callableMock` は既に `getMyLessonResultCallable` 以外の名前にもマッチする汎用モックなので、`httpsCallableMock` が `'getMyLessonResultCallable'` を受けたときの戻り値を明示的に設定する必要がある — 既存の `httpsCallableMock` 実装（[src/App.test.tsx:87-93](../../../src/App.test.tsx:87)）に分岐を追加する）:

```ts
const httpsCallableMock = vi.fn((_functions: unknown, name: string) => {
  if (name === 'getHouseholdTeacherDashboardCallable') {
    return vi.fn().mockResolvedValue({ data: defaultDashboardData })
  }
  if (name === 'getMyLessonResultCallable') {
    return vi.fn().mockResolvedValue({ data: { found: false, lessonRunId: 'run-1', items: [] } })
  }
  return callableMock
})
```

そのうえで `describe('Phase B lesson platform routes (Task 17)', ...)` ブロック内に追加する:

```ts
  it('shows a not-yet-generated message at /results when no result exists', async () => {
    window.history.pushState({}, '', '/lessons/run-1/results')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    await waitFor(() => expect(membershipListener).toBeDefined())
    emitMembership({ access: 'ACTIVE', teamId: 'team-a' })
    await waitFor(() => expect(publicStateListener).toBeDefined())
    emitPublicState({ status: 'REFLECTION', title: '株式投資シミュレーション', teams: [{ teamId: 'team-a', displayName: 'Aチーム' }] })
    expect(await screen.findByText('まだ結果が発表されていません。教師の案内をお待ちください。')).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('renders LessonResultsPage at /results once a result is found', async () => {
    window.history.pushState({}, '', '/lessons/run-1/results')
    httpsCallableMock.mockImplementation((_functions: unknown, name: string) => {
      if (name === 'getMyLessonResultCallable') {
        return vi.fn().mockResolvedValue({
          data: {
            found: true, lessonRunId: 'run-1',
            items: [{ responseId: 'r-1', scope: 'participant', displayValue: '選択肢A', decisionExplanation: { whatHappened: 'a', whyItHappened: 'b', alternative: 'c', nextAction: 'd' } }],
          },
        })
      }
      return callableMock
    })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    await waitFor(() => expect(membershipListener).toBeDefined())
    emitMembership({ access: 'ACTIVE', teamId: 'team-a' })
    await waitFor(() => expect(publicStateListener).toBeDefined())
    emitPublicState({ status: 'COMPLETED', title: '株式投資シミュレーション', teams: [{ teamId: 'team-a', displayName: 'Aチーム' }] })
    expect(await screen.findByText('選択肢A')).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
```

- [ ] **Step 6: Run the test file**

Run: `npm test -- src/App.test.tsx`
Expected: PASS（全テスト）

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire /lessons/:runId/results to the student's own filtered result via getMyLessonResultCallable"
```

---

## Task 6: Phase 4完了確認

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: lint, typecheck, tests, rules, market concurrency, build すべてPASS

- [ ] **Step 2: Manual end-to-end smoke test**

1. `npm run dev` でローカル起動
2. Phase 1〜3のフローで授業を作成・開始し、生徒を参加させ、注文まで進める
3. 教師側で授業を `REFLECTION` に進め（既存の教師操作フローに従う。まだUIから直接進める導線がなければ、少なくともこの手順でテストできることを確認するのみで良い — フェーズ進行導線自体はPhase 6のスコープ）、Control Roomに「結果を生成する」ボタンが表示されることを確認
4. ボタンを押して結果を生成し、生徒側の `/lessons/{runId}/results` に自分の回答のみが表示されることを確認（他チームの回答が含まれていないことを確認）
5. 結果生成前に生徒が `/results` にアクセスした場合、「まだ結果が発表されていません」と表示されることを確認

- [ ] **Step 3: Update the roadmap**

[docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md](2026-08-17-production-readiness-roadmap.md) の "Phase 4" セクションに完了マークを付ける。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md
git commit -m "docs: mark Phase 4 complete in production readiness roadmap"
```
