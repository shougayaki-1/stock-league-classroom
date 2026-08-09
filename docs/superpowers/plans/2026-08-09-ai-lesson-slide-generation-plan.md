# スライド自動生成（説明スライド手動入力+AI下書き）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-ai-lesson-slide-generation-design.md`（設計仕様）。矛盾する場合は仕様書を優先する。

**Goal:** 既存の教室投影コンポーネント`ExplanationSlide`が表示する`teacherGuidance`フィールドに、教師が手動で文言を設定できる土台（Callable+UI）を作り、その上にAIが文言を下書きする機能を載せる。

**Architecture:** `functions/`→`src/`のrootDir境界制約により、サーバー側・クライアント側で型を手動同期する（既存の全サブプロジェクトと同じ規律）。新規Callable2つ（`setTeacherGuidanceCallable`・`generateTeacherGuidanceCallable`）。`setTeacherGuidanceCallable`は、このプロジェクト全体で唯一実在するRTDB `lessonRunDisplay/{lessonRunId}`への書き込み経路になる（既存の`toLessonRunDisplayState`/`LessonRunProjectionSource`は使わず、必要最小限のフィールドから直接`LessonRunDisplayState`を組み立てる——理由はTask 4参照）。

**Tech Stack:** TypeScript, React, MUI, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK (Firestore + Realtime Database), Vitest, React Testing Library。

## Global Constraints

- 新規Callableは`functions/src/index.ts`からexportする（この既知の抜け漏れパターンを再発させない）。
- 認可は既存の`isCallerTeacher`（`functions/src/organizations/onCall.ts`）・`requireActiveOrgMember`（`functions/src/organizations/authorization.ts`）をそのまま再利用する。新しい認可ロジックは書かない。
- `setTeacherGuidanceCallable`の認可は`issueDisplaySessionTokenCallable`（`functions/src/lessonRuns/projections/onCall.ts`）と同一パターン: 対象`lessonRuns/{lessonRunId}`ドキュメントの`teacherRoles[uid]`が`'PRIMARY'`または`'ASSISTANT'`であることを確認する。
- `generateTeacherGuidanceCallable`は`generateLessonDraftCallable`（`functions/src/ai/onCall.ts`）と同じ骨格（`aiEnabled`チェック→`unconfiguredLlmProvider`→使用ログ）に従う。Firestoreへの直接書き込みは行わない。
- `lessonRunPublic`ノードは触らない（`teacherGuidance`は`toLessonRunPublicState`の出力フィールドに存在しないため）。
- RTDB `lessonRunDisplay`ノードは`getDatabase().ref(...).set(...)`で書き込む（`publicProjection.ts`の`setDisplayState`と同じ書き込み経路）。
- 冪等性キーは導入しない（設計仕様で不要と判断済み）。
- 日本語UI文言を用いる（既存コンポーネントの慣例）。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`（モノレポ全体のlint/typecheck/test/build）を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/ai/teacherGuidancePrompt.ts`, `.test.ts` | Create（Task 1） |
| `functions/src/ai/onCall.ts`, `.test.ts` | Modify（Task 2。`generateTeacherGuidanceCallable`追加） |
| `functions/src/index.ts` | Modify（Task 2・Task 5。export追加） |
| `src/lib/ai/generateTeacherGuidance.ts`, `.test.ts` | Create（Task 3） |
| `functions/src/lessonRuns/projections/setTeacherGuidance.ts`, `.test.ts` | Create（Task 4） |
| `functions/src/lessonRuns/projections/onCall.ts`, `.test.ts` | Modify（Task 5。`setTeacherGuidanceCallable`追加） |
| `src/lib/lessonRuns/setTeacherGuidance.ts`, `.test.ts` | Create（Task 6） |
| `src/components/teacher/TeacherGuidanceDialog.tsx`, `.test.tsx` | Create（Task 7） |
| `src/components/teacher/LessonControlRoom.tsx`, `.test.tsx` | Modify（Task 8。ダイアログ起動ボタン追加） |

---

## タスク一覧

### Task 1: AIプロンプトビルダー（説明文下書き）

**Files:**
- Create: `functions/src/ai/teacherGuidancePrompt.ts`
- Test: `functions/src/ai/teacherGuidancePrompt.test.ts`

**Interfaces:**
- Produces: `TeacherGuidancePromptInput { topic: string }`、`buildTeacherGuidancePrompt(input: TeacherGuidancePromptInput): string`、`parseTeacherGuidanceResponse(text: string): { teacherGuidance: string }`。Task 2で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/ai/teacherGuidancePrompt.test.ts
import { describe, expect, it } from 'vitest'
import { buildTeacherGuidancePrompt, parseTeacherGuidanceResponse } from './teacherGuidancePrompt'

describe('teacher guidance prompt', () => {
  it('includes the teacher-supplied topic and requests a JSON teacherGuidance field', () => {
    const prompt = buildTeacherGuidancePrompt({ topic: '今日の株価変動の背景' })
    expect(prompt).toContain('今日の株価変動の背景')
    expect(prompt).toContain('JSON')
  })

  it('parses only a teacherGuidance JSON object', () => {
    expect(parseTeacherGuidanceResponse('{"teacherGuidance":"本日は需要の増加が価格上昇の主因でした。"}'))
      .toEqual({ teacherGuidance: '本日は需要の増加が価格上昇の主因でした。' })
    expect(() => parseTeacherGuidanceResponse('not json')).toThrow('AI response was not valid JSON')
    expect(() => parseTeacherGuidanceResponse('{"teacherGuidance":123}')).toThrow('AI response is missing required field: teacherGuidance')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/ai/teacherGuidancePrompt.test.ts`
Expected: FAIL（`teacherGuidancePrompt`モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/ai/teacherGuidancePrompt.ts
export interface TeacherGuidancePromptInput { topic: string }
export interface ParsedTeacherGuidance { teacherGuidance: string }

export const buildTeacherGuidancePrompt = (input: TeacherGuidancePromptInput): string => `あなたは学校教員向けの授業支援アシスタントです。教室のプロジェクター画面（説明スライド）に表示する、生徒向けの短い説明文を1つ作成してください。
説明したいトピック: ${input.topic}
必ず次のJSONのみを出力してください: {"teacherGuidance":"説明文の本文"}`

export const parseTeacherGuidanceResponse = (text: string): ParsedTeacherGuidance => {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('AI response was not valid JSON') }
  if (!parsed || typeof parsed !== 'object') throw new Error('AI response was not valid JSON')
  const record = parsed as Record<string, unknown>
  if (typeof record.teacherGuidance !== 'string') throw new Error('AI response is missing required field: teacherGuidance')
  return { teacherGuidance: record.teacherGuidance }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/ai/teacherGuidancePrompt.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/ai/teacherGuidancePrompt.ts functions/src/ai/teacherGuidancePrompt.test.ts
git commit -m "feat: 説明スライドAI下書き用プロンプトビルダーを追加"
```

---

### Task 2: `generateTeacherGuidanceCallable`

**Files:**
- Modify: `functions/src/ai/onCall.ts`
- Modify: `functions/src/ai/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `buildTeacherGuidancePrompt`/`parseTeacherGuidanceResponse`（Task 1）、`unconfiguredLlmProvider`（既存、`functions/src/ai/llmProvider.ts`）、`isCallerTeacher`（既存）。
- Produces: `generateTeacherGuidanceCallable`（Callable名。クライアントは`httpsCallable(functions, 'generateTeacherGuidanceCallable')`で呼ぶ）。入力`{topic: string}`、出力`{teacherGuidance: string}`。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/onCall.test.ts`の末尾に追記する（既存の`generateLessonDraftCallable`のテストと同じモック・スタイルに揃える）:

```ts
import { generateLessonDraftCallable, generateTeacherGuidanceCallable } from './onCall'
// ↑ 既存のimport行を置き換える（generateTeacherGuidanceCallableを追加）

describe('generateTeacherGuidanceCallable', () => {
  beforeEach(() => { vi.clearAllMocks(); usageLogAdd.mockResolvedValue(undefined) })

  it('rejects unauthenticated callers', async () => {
    const req = { auth: null, data: { topic: '株価変動の背景' }, rawRequest: {} } as unknown as CallableRequest
    await expect(generateTeacherGuidanceCallable.run(req)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects while the organization has AI disabled without logging a usage attempt', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => false })
    const req = { auth: teacher, data: { topic: '株価変動の背景' }, rawRequest: {} } as unknown as CallableRequest
    await expect(generateTeacherGuidanceCallable.run(req)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(usageLogAdd).not.toHaveBeenCalled()
  })

  it('logs provider failure and returns a safe unavailable error', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    const req = { auth: teacher, data: { topic: '株価変動の背景' }, rawRequest: {} } as unknown as CallableRequest
    await expect(generateTeacherGuidanceCallable.run(req)).rejects.toMatchObject({ code: 'unavailable' })
    expect(usageLogAdd).toHaveBeenCalledWith(expect.objectContaining({ feature: 'TEACHER_GUIDANCE', succeeded: false }))
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: FAIL（`generateTeacherGuidanceCallable`が存在しない）

- [ ] **Step 3: 実装する**

`functions/src/ai/onCall.ts`の`import`群を以下に置き換える:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { personalOrgId } from '../lib/personalOrgId'
import { isCallerTeacher } from '../organizations/onCall'
import { unconfiguredLlmProvider } from './llmProvider'
import { assertNoForbiddenFields } from './piiFilter'
import { buildLessonDraftPrompt, parseLessonDraftResponse, type LessonDraftPromptInput } from './lessonDraftPrompt'
import { buildTeacherGuidancePrompt, parseTeacherGuidanceResponse, type TeacherGuidancePromptInput } from './teacherGuidancePrompt'
```

既存の`generateLessonDraftCallable`定義の直後（ファイル末尾）に追記する:

```ts
interface GenerateTeacherGuidanceRequest { topic?: unknown }
const isValidTeacherGuidanceRequest = (data: GenerateTeacherGuidanceRequest): data is TeacherGuidancePromptInput =>
  typeof data.topic === 'string' && data.topic.length > 0

/** 説明スライド(teacherGuidance)のAI下書き。generateLessonDraftCallableと同じ骨格——Firestoreへは書き込まず、教師の確認・保存は既存のsetTeacherGuidanceCallable(別Callable)が担う。 */
export const generateTeacherGuidanceCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const teacherUid = request.auth.uid
  const data = request.data as GenerateTeacherGuidanceRequest
  if (!isValidTeacherGuidanceRequest(data)) throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const db = getFirestore()
  const orgId = personalOrgId(teacherUid)
  const org = await db.doc(`organizations/${orgId}`).get()
  if (!org.exists || org.get('aiEnabled') !== true) throw new HttpsError('failed-precondition', 'AI機能はこの組織では有効化されていません。')
  const logUsage = (succeeded: boolean) => db.collection(`organizations/${orgId}/aiUsageLog`).add({ orgId, teacherUid, feature: 'TEACHER_GUIDANCE', succeeded, createdAt: new Date() })
  try {
    assertNoForbiddenFields(data as unknown as Record<string, unknown>)
    const result = parseTeacherGuidanceResponse(await unconfiguredLlmProvider.generateText(buildTeacherGuidancePrompt(data)))
    await logUsage(true)
    return result
  } catch {
    await logUsage(false)
    throw new HttpsError('unavailable', 'AI下書きの生成に失敗しました。手動で入力してください。')
  }
})
```

`functions/src/index.ts`の`export { generateLessonDraftCallable } from './ai/onCall'`を以下に置き換える:

```ts
export { generateLessonDraftCallable, generateTeacherGuidanceCallable } from './ai/onCall'
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/ai/onCall.ts functions/src/ai/onCall.test.ts functions/src/index.ts
git commit -m "feat: 説明スライドAI下書きCallable(generateTeacherGuidanceCallable)を追加"
```

---

### Task 3: クライアントラッパー（AI下書き呼び出し）

**Files:**
- Create: `src/lib/ai/generateTeacherGuidance.ts`
- Test: `src/lib/ai/generateTeacherGuidance.test.ts`

**Interfaces:**
- Produces: `generateTeacherGuidance(functions: Functions, input: {topic: string}): Promise<{teacherGuidance: string}>`。Task 7で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/ai/generateTeacherGuidance.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { generateTeacherGuidance } from './generateTeacherGuidance'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('generateTeacherGuidance', () => {
  it('calls generateTeacherGuidanceCallable with the input and returns its data', async () => {
    const call = vi.fn().mockResolvedValue({ data: { teacherGuidance: '本日は需要増が主因でした。' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(generateTeacherGuidance({} as never, { topic: '株価変動の背景' }))
      .resolves.toEqual({ teacherGuidance: '本日は需要増が主因でした。' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'generateTeacherGuidanceCallable')
    expect(call).toHaveBeenCalledWith({ topic: '株価変動の背景' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/ai/generateTeacherGuidance.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/ai/generateTeacherGuidance.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface GenerateTeacherGuidanceInput { topic: string }
export interface GeneratedTeacherGuidance { teacherGuidance: string }

export const generateTeacherGuidance = async (functions: Functions, input: GenerateTeacherGuidanceInput): Promise<GeneratedTeacherGuidance> =>
  (await httpsCallable<GenerateTeacherGuidanceInput, GeneratedTeacherGuidance>(functions, 'generateTeacherGuidanceCallable')(input)).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/ai/generateTeacherGuidance.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/ai/generateTeacherGuidance.ts src/lib/ai/generateTeacherGuidance.test.ts
git commit -m "feat: 説明スライドAI下書きのクライアントラッパーを追加"
```

---

### Task 4: `setTeacherGuidance`（純粋関数 — Firestore書き込み+RTDB表示状態の組み立て）

**Files:**
- Create: `functions/src/lessonRuns/projections/setTeacherGuidance.ts`
- Test: `functions/src/lessonRuns/projections/setTeacherGuidance.test.ts`

**Interfaces:**
- Consumes: `deriveDisplayMode`（既存、`functions/src/lessonRuns/projections/displayProjection.ts`）、`LessonRunDisplayState`型（既存、同ファイル）。
- Produces: `SetTeacherGuidanceDeps`（`firestore`/`setDisplayState`/`now`の3フィールド）、`SetTeacherGuidanceInput { lessonRunId: string; teacherGuidance: string }`、`setTeacherGuidance(deps, input): Promise<{teacherGuidance: string | null}>`、`setTeacherGuidanceWithAdminSdk(input): Promise<{teacherGuidance: string | null}>`。Task 5で消費される。

**設計メモ（このタスクの実装判断）:** 既存の`toLessonRunDisplayState`は引数として完全な`LessonRunProjectionSource`（`randomSeed`/`restoreGeneration`等、このCallableが一切関与しないFORBIDDENフィールドを含む）を要求する。それらにダミー値を詰めて渡すのはコードとして誤解を招く（実際には存在しない値を「ある」ことにしてしまう）ため、本タスクでは`toLessonRunDisplayState`を経由せず、`deriveDisplayMode`だけを再利用して`LessonRunDisplayState`を直接組み立てる。出力の構造・意味は`toLessonRunDisplayState`が生成するものと完全に同一。

**設計メモ（`title`/`goal`について）:** `lessonRuns/{id}`ドキュメントに`title`フィールドは存在しないため、作成時に保存された`templateSnapshot.title`（`LessonContent.title`、`src/lib/lessonTemplates/types.ts`）を使う。`goal`に対応するフィールドはこのドキュメントにもテンプレートにも現時点で存在しないため、`null`固定とする（他の投影未実装フィールドと同様、将来の別タスクの対象）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/lessonRuns/projections/setTeacherGuidance.test.ts
import { describe, expect, it, vi } from 'vitest'
import { setTeacherGuidance } from './setTeacherGuidance'

const makeDeps = (overrides: { runData?: Record<string, unknown>; teamDocs?: Record<string, unknown>[] } = {}) => {
  const updateMock = vi.fn().mockResolvedValue(undefined)
  const runData = { orgId: 'org-1', status: 'REFLECTION', templateSnapshot: { title: '市場シミュレーション第1回' }, ...overrides.runData }
  const teamDocs = overrides.teamDocs ?? [{ id: 'team-a', displayName: 'チームA' }]
  const setDisplayState = vi.fn().mockResolvedValue(undefined)
  const firestore = {
    doc: () => ({
      update: updateMock,
      get: async () => ({ exists: true, data: () => runData }),
    }),
    collection: () => ({
      get: async () => ({ docs: teamDocs.map((d) => ({ data: () => d })) }),
    }),
  }
  return { deps: { firestore, setDisplayState, now: () => 1000 }, updateMock, setDisplayState }
}

describe('setTeacherGuidance', () => {
  it('writes the guidance text to Firestore and publishes the display state to RTDB', async () => {
    const { deps, updateMock, setDisplayState } = makeDeps()
    const result = await setTeacherGuidance(deps, { lessonRunId: 'run-1', teacherGuidance: '本日は需要増が主因でした。' })
    expect(result).toEqual({ teacherGuidance: '本日は需要増が主因でした。' })
    expect(updateMock).toHaveBeenCalledWith({ teacherGuidance: '本日は需要増が主因でした。' })
    expect(setDisplayState).toHaveBeenCalledWith('run-1', {
      orgId: 'org-1', mode: 'EXPLANATION', title: '市場シミュレーション第1回', goal: null,
      teams: [{ teamId: 'team-a', displayName: 'チームA', publicAggregateLabel: null }],
      teacherGuidance: '本日は需要増が主因でした。', updatedAtMillis: 1000,
    })
  })

  it('normalizes an empty string to null (clearing the guidance)', async () => {
    const { deps, updateMock, setDisplayState } = makeDeps()
    const result = await setTeacherGuidance(deps, { lessonRunId: 'run-1', teacherGuidance: '' })
    expect(result).toEqual({ teacherGuidance: null })
    expect(updateMock).toHaveBeenCalledWith({ teacherGuidance: null })
    expect(setDisplayState).toHaveBeenCalledWith('run-1', expect.objectContaining({ teacherGuidance: null }))
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/projections/setTeacherGuidance.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/lessonRuns/projections/setTeacherGuidance.ts
import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { deriveDisplayMode, type LessonRunDisplayState } from './displayProjection'

export interface SetTeacherGuidanceDeps {
  firestore: {
    doc: (path: string) => {
      update: (data: Record<string, unknown>) => Promise<void>
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
    }
    collection: (path: string) => { get: () => Promise<{ docs: { data: () => Record<string, unknown> }[] }> }
  }
  setDisplayState: (lessonRunId: string, state: LessonRunDisplayState) => Promise<void>
  now?: () => number
}
export interface SetTeacherGuidanceInput { lessonRunId: string; teacherGuidance: string }
export interface SetTeacherGuidanceResult { teacherGuidance: string | null }

/**
 * `lessonRuns/{lessonRunId}.teacherGuidance`をFirestoreへ書き込み(システムの正本)、
 * 直後に`lessonRunDisplay/{lessonRunId}`(RTDB)へも反映する。このCallable専用の
 * 最小限のフィールドだけを読み、`toLessonRunDisplayState`は使わない——理由は
 * このファイルを追加したTask 4の設計メモを参照。
 */
export const setTeacherGuidance = async (
  deps: SetTeacherGuidanceDeps,
  input: SetTeacherGuidanceInput,
): Promise<SetTeacherGuidanceResult> => {
  const normalized = input.teacherGuidance === '' ? null : input.teacherGuidance
  const runRef = deps.firestore.doc(`lessonRuns/${input.lessonRunId}`)
  await runRef.update({ teacherGuidance: normalized })

  const runSnap = await runRef.get()
  const runData = runSnap.data() as {
    orgId: string
    status: string
    templateSnapshot?: { title?: string }
  }
  const teamsSnap = await deps.firestore.collection(`lessonRuns/${input.lessonRunId}/teams`).get()
  const teams = teamsSnap.docs.map((doc) => doc.data() as { id: string; displayName: string })

  const displayState: LessonRunDisplayState = {
    orgId: runData.orgId,
    mode: deriveDisplayMode(runData.status),
    title: runData.templateSnapshot?.title ?? '',
    goal: null,
    teams: teams.map((team) => ({ teamId: team.id, displayName: team.displayName, publicAggregateLabel: null })),
    teacherGuidance: normalized,
    updatedAtMillis: deps.now ? deps.now() : Date.now(),
  }
  await deps.setDisplayState(input.lessonRunId, displayState)

  return { teacherGuidance: normalized }
}

/** Production wiring: Firestore + RTDB Admin SDK, matching publicProjection.ts's setDisplayState. */
export const setTeacherGuidanceWithAdminSdk = (input: SetTeacherGuidanceInput): Promise<SetTeacherGuidanceResult> => {
  const db = getFirestore()
  return setTeacherGuidance({
    firestore: {
      doc: (path) => {
        const ref = db.doc(path)
        return { update: (data) => ref.update(data), get: async () => { const snap = await ref.get(); return { exists: snap.exists, data: () => snap.data() } } }
      },
      collection: (path) => ({ get: async () => { const snap = await db.collection(path).get(); return { docs: snap.docs.map((d) => ({ data: () => d.data() })) } } }),
    },
    setDisplayState: async (lessonRunId, state) => { await getDatabase().ref(`lessonRunDisplay/${lessonRunId}`).set(state) },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/projections/setTeacherGuidance.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/lessonRuns/projections/setTeacherGuidance.ts functions/src/lessonRuns/projections/setTeacherGuidance.test.ts
git commit -m "feat: teacherGuidanceの書き込み+教室投影RTDBへの反映ロジックを追加"
```

---

### Task 5: `setTeacherGuidanceCallable`

**Files:**
- Modify: `functions/src/lessonRuns/projections/onCall.ts`
- Modify: `functions/src/lessonRuns/projections/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `setTeacherGuidanceWithAdminSdk`（Task 4）。
- Produces: `setTeacherGuidanceCallable`（Callable名`setTeacherGuidanceCallable`）。入力`{lessonRunId: string, teacherGuidance: string}`、出力`{teacherGuidance: string | null}`。Task 6で消費される。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/projections/onCall.test.ts`に追記する（既存の`issueDisplaySessionTokenCallable`のテストと同じモック構成に、`setTeacherGuidanceWithAdminSdk`のモックを追加する）:

```ts
// 既存のimport行を置き換える
import { exchangeDisplaySessionTokenCallable, issueDisplaySessionTokenCallable, setTeacherGuidanceCallable } from './onCall'
import { setTeacherGuidanceWithAdminSdk } from './setTeacherGuidance'

// 既存の vi.mock('./displaySession', ...) の下に追記
vi.mock('./setTeacherGuidance', () => ({ setTeacherGuidanceWithAdminSdk: vi.fn() }))
const setGuidanceMock = vi.mocked(setTeacherGuidanceWithAdminSdk)

describe('setTeacherGuidanceCallable', () => {
  it('rejects an unauthenticated caller', async () => {
    const request = { auth: undefined, data: { lessonRunId: 'run-1', teacherGuidance: '説明文' } } as unknown as CallableRequest
    await expect(setTeacherGuidanceCallable.run(request)).rejects.toThrow('サインインが必要です。')
  })

  it('rejects a teacher with only VIEWER role on this run', async () => {
    docGetMock.mockResolvedValueOnce(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken }, data: { lessonRunId: 'run-1', teacherGuidance: '説明文' },
    } as unknown as CallableRequest
    await expect(setTeacherGuidanceCallable.run(request)).rejects.toThrow('PRIMARYまたはASSISTANTの教師のみ説明スライドを編集できます。')
  })

  it('sets the guidance for a PRIMARY teacher with active org membership', async () => {
    docGetMock.mockResolvedValueOnce(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    requireActiveOrgMemberMock.mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    setGuidanceMock.mockResolvedValueOnce({ teacherGuidance: '説明文' })
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken }, data: { lessonRunId: 'run-1', teacherGuidance: '説明文' },
    } as unknown as CallableRequest
    const result = await setTeacherGuidanceCallable.run(request)
    expect(result).toEqual({ teacherGuidance: '説明文' })
    expect(setGuidanceMock).toHaveBeenCalledWith({ lessonRunId: 'run-1', teacherGuidance: '説明文' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/projections/onCall.test.ts`
Expected: FAIL（`setTeacherGuidanceCallable`が存在しない）

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/projections/onCall.ts`の`import`群を以下に置き換える:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../../organizations/onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { exchangeDisplaySessionTokenWithAdminSdk, issueDisplaySessionTokenWithAdminSdk } from './displaySession'
import { setTeacherGuidanceWithAdminSdk } from './setTeacherGuidance'
```

ファイル末尾に追記する:

```ts
interface SetTeacherGuidanceRequest { lessonRunId: string; teacherGuidance: string }

/**
 * 認可はissueDisplaySessionTokenCallableと同一パターン: 対象lessonRunの
 * teacherRolesがPRIMARY/ASSISTANTのいずれかの教師のみ、説明スライドの
 * 文言を編集できる。
 */
export const setTeacherGuidanceCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as SetTeacherGuidanceRequest
  if (!data.lessonRunId || typeof data.teacherGuidance !== 'string') throw new HttpsError('invalid-argument', 'lessonRunId と teacherGuidance は必須です。')

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (role !== 'PRIMARY' && role !== 'ASSISTANT') {
    throw new HttpsError('permission-denied', 'PRIMARYまたはASSISTANTの教師のみ説明スライドを編集できます。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  return setTeacherGuidanceWithAdminSdk({ lessonRunId: data.lessonRunId, teacherGuidance: data.teacherGuidance })
})
```

`functions/src/index.ts`の`projections/onCall`からのexport行に`setTeacherGuidanceCallable`を追加する（既存の`}` from './lessonRuns/projections/onCall'`のブロックへ追記）。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/projections/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/lessonRuns/projections/onCall.ts functions/src/lessonRuns/projections/onCall.test.ts functions/src/index.ts
git commit -m "feat: 説明スライド設定Callable(setTeacherGuidanceCallable)を追加"
```

---

### Task 6: クライアントラッパー（保存呼び出し）

**Files:**
- Create: `src/lib/lessonRuns/setTeacherGuidance.ts`
- Test: `src/lib/lessonRuns/setTeacherGuidance.test.ts`

**Interfaces:**
- Produces: `setTeacherGuidance(functions: Functions, input: {lessonRunId: string; teacherGuidance: string}): Promise<{teacherGuidance: string | null}>`。Task 7・8で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/lessonRuns/setTeacherGuidance.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { setTeacherGuidance } from './setTeacherGuidance'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('setTeacherGuidance', () => {
  it('calls setTeacherGuidanceCallable with the input and returns its data', async () => {
    const call = vi.fn().mockResolvedValue({ data: { teacherGuidance: '説明文' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(setTeacherGuidance({} as never, { lessonRunId: 'run-1', teacherGuidance: '説明文' }))
      .resolves.toEqual({ teacherGuidance: '説明文' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'setTeacherGuidanceCallable')
    expect(call).toHaveBeenCalledWith({ lessonRunId: 'run-1', teacherGuidance: '説明文' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/lessonRuns/setTeacherGuidance.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/lessonRuns/setTeacherGuidance.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface SetTeacherGuidanceInput { lessonRunId: string; teacherGuidance: string }
export interface SetTeacherGuidanceResult { teacherGuidance: string | null }

export const setTeacherGuidance = async (functions: Functions, input: SetTeacherGuidanceInput): Promise<SetTeacherGuidanceResult> =>
  (await httpsCallable<SetTeacherGuidanceInput, SetTeacherGuidanceResult>(functions, 'setTeacherGuidanceCallable')(input)).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/lessonRuns/setTeacherGuidance.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/lessonRuns/setTeacherGuidance.ts src/lib/lessonRuns/setTeacherGuidance.test.ts
git commit -m "feat: 説明スライド設定のクライアントラッパーを追加"
```

---

### Task 7: `TeacherGuidanceDialog`（編集ダイアログ）

**Files:**
- Create: `src/components/teacher/TeacherGuidanceDialog.tsx`
- Test: `src/components/teacher/TeacherGuidanceDialog.test.tsx`

**Interfaces:**
- Consumes: `generateTeacherGuidance`（Task 3）、`setTeacherGuidance`（Task 6）。
- Produces: `TeacherGuidanceDialog`コンポーネント。Props: `{open: boolean; onClose: () => void; lessonRunId: string; initialGuidance: string | null; functions: Functions; aiEnabled: boolean}`。Task 8で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// src/components/teacher/TeacherGuidanceDialog.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'
import { TeacherGuidanceDialog } from './TeacherGuidanceDialog'
import * as generateModule from '../../lib/ai/generateTeacherGuidance'
import * as setModule from '../../lib/lessonRuns/setTeacherGuidance'

vi.mock('../../lib/ai/generateTeacherGuidance')
vi.mock('../../lib/lessonRuns/setTeacherGuidance')

const functions = {} as Functions

describe('TeacherGuidanceDialog', () => {
  it('saves the edited guidance text', async () => {
    const setMock = vi.mocked(setModule.setTeacherGuidance).mockResolvedValue({ teacherGuidance: '新しい説明文' })
    const user = userEvent.setup()
    render(<TeacherGuidanceDialog open lessonRunId="run-1" initialGuidance="旧文言" functions={functions} aiEnabled={false} onClose={vi.fn()} />)
    const textbox = screen.getByRole('textbox', { name: '説明スライドの文言' })
    await user.clear(textbox)
    await user.type(textbox, '新しい説明文')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(setMock).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1', teacherGuidance: '新しい説明文' }))
  })

  it('drafts guidance text with AI when aiEnabled is true, without saving it', async () => {
    const generateMock = vi.mocked(generateModule.generateTeacherGuidance).mockResolvedValue({ teacherGuidance: 'AIが下書きした説明文' })
    const setMock = vi.mocked(setModule.setTeacherGuidance)
    const user = userEvent.setup()
    render(<TeacherGuidanceDialog open lessonRunId="run-1" initialGuidance={null} functions={functions} aiEnabled onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'AIに伝えるトピック' }), '株価変動の背景')
    await user.click(screen.getByRole('button', { name: 'AIで下書き' }))
    await waitFor(() => expect(generateMock).toHaveBeenCalledWith(functions, { topic: '株価変動の背景' }))
    expect(screen.getByRole('textbox', { name: '説明スライドの文言' })).toHaveValue('AIが下書きした説明文')
    expect(setMock).not.toHaveBeenCalled()
  })

  it('hides the AI draft controls when aiEnabled is false', () => {
    render(<TeacherGuidanceDialog open lessonRunId="run-1" initialGuidance={null} functions={functions} aiEnabled={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'AIで下書き' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/TeacherGuidanceDialog.test.tsx`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```tsx
// src/components/teacher/TeacherGuidanceDialog.tsx
import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import type { Functions } from 'firebase/functions'
import { generateTeacherGuidance } from '../../lib/ai/generateTeacherGuidance'
import { setTeacherGuidance } from '../../lib/lessonRuns/setTeacherGuidance'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

export interface TeacherGuidanceDialogProps {
  open: boolean
  onClose: () => void
  lessonRunId: string
  initialGuidance: string | null
  functions: Functions
  aiEnabled: boolean
}

/** 既存のExplanationSlideが表示するteacherGuidanceを編集するダイアログ。AI下書きはaiEnabledがtrueの場合のみ表示し、生成結果はテキスト欄への反映のみ(未保存)——保存は必ず教師の「保存」操作を経由する。 */
export function TeacherGuidanceDialog({ open, onClose, lessonRunId, initialGuidance, functions, aiEnabled }: TeacherGuidanceDialogProps) {
  const [guidance, setGuidance] = useState(initialGuidance ?? '')
  const [topic, setTopic] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDraft = async () => {
    setDrafting(true)
    setError(null)
    try {
      const result = await generateTeacherGuidance(functions, { topic })
      setGuidance(result.teacherGuidance)
    } catch {
      setError('AI下書きに失敗しました。手動で入力してください。')
    } finally {
      setDrafting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await setTeacherGuidance(functions, { lessonRunId, teacherGuidance: guidance })
      onClose()
    } catch {
      setError('保存に失敗しました。もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>説明スライドを編集</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {aiEnabled && (
            <Stack spacing={1}>
              <TextField
                label="AIに伝えるトピック"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例: 今日の株価変動の背景"
              />
              <Button variant="outlined" onClick={handleDraft} disabled={drafting || topic.length === 0} sx={{ minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start' }}>
                {drafting ? '下書き中…' : 'AIで下書き'}
              </Button>
            </Stack>
          )}
          <TextField
            label="説明スライドの文言"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            multiline
            minRows={4}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: MIN_TOUCH_TARGET }}>キャンセル</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ minHeight: MIN_TOUCH_TARGET }}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/TeacherGuidanceDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/teacher/TeacherGuidanceDialog.tsx src/components/teacher/TeacherGuidanceDialog.test.tsx
git commit -m "feat: 説明スライド編集ダイアログ(手動入力+AI下書き)を追加"
```

---

### Task 8: `LessonControlRoom`への統合

**Files:**
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Interfaces:**
- Consumes: `TeacherGuidanceDialog`（Task 7）。
- Produces: `LessonControlRoomProps`に`aiEnabled?: boolean`（既定`false`）を追加。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/LessonControlRoom.test.tsx`に追記する（既存の`emitDisplay`ヘルパー・`role`propの渡し方をそのまま使う）:

```tsx
it('opens the guidance dialog for a PRIMARY teacher, prefilled with the current display-state guidance', async () => {
  const user = userEvent.setup()
  render(
    <LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />,
  )
  emitDisplay({ teacherGuidance: '既存の文言' })
  await user.click(screen.getByRole('button', { name: '説明スライドを編集' }))
  expect(screen.getByRole('heading', { name: '説明スライドを編集' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '説明スライドの文言' })).toHaveValue('既存の文言')
})

it('hides the guidance edit button for a VIEWER', () => {
  render(
    <LessonControlRoom lessonRunId="run-1" role="VIEWER" functions={functions} firestore={firestore} database={database} />,
  )
  expect(screen.queryByRole('button', { name: '説明スライドを編集' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/LessonControlRoom.test.tsx`
Expected: FAIL（ボタンが存在しない）

- [ ] **Step 3: 実装する**

`src/components/teacher/LessonControlRoom.tsx`の`import`群に追記する:

```ts
import { TeacherGuidanceDialog } from './TeacherGuidanceDialog'
```

`LessonControlRoomProps`インターフェースに追記する:

```ts
  /** organizations/{orgId}.aiEnabled の値。呼び出し元(画面ルート)がFirestoreから読み取って渡す——既存のTemplateNewRouteと同じ受け渡しパターン。 */
  aiEnabled?: boolean
```

コンポーネント引数の分割代入に`aiEnabled = false`を追加し、`interventionOpen`のstateの下に`guidanceDialogOpen`のstateを追加する:

```ts
  const [guidanceDialogOpen, setGuidanceDialogOpen] = useState(false)
```

`canHandleConnection`の定義の下に、説明スライド編集の可否を追加する:

```ts
  const canEditGuidance = role === 'PRIMARY' || role === 'ASSISTANT'
```

操作ボタン群（`介入操作を開く`ボタンのある`Stack`）に、以下のボタンを追記する:

```tsx
          {canEditGuidance && (
            <Button variant="outlined" onClick={() => setGuidanceDialogOpen(true)} sx={{ minHeight: MIN_TOUCH_TARGET }}>
              説明スライドを編集
            </Button>
          )}
```

`InterventionPanel`の直後に追記する:

```tsx
      {canEditGuidance && (
        <TeacherGuidanceDialog
          open={guidanceDialogOpen}
          onClose={() => setGuidanceDialogOpen(false)}
          lessonRunId={lessonRunId}
          initialGuidance={displayState?.teacherGuidance ?? null}
          functions={functions}
          aiEnabled={aiEnabled}
        />
      )}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/LessonControlRoom.test.tsx`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx
git commit -m "feat: LessonControlRoomに説明スライド編集ボタンを統合"
```
