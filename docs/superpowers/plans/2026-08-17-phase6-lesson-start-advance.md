# Phase 6: Control Roomからの開始/進行操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師が Control Room から「授業を開始」「次のフェーズへ進む」を実際に実行できるようにする。

**Architecture:** 調査の結果、根本的なブロッカーが判明した — `transitionPhaseCallable` が `targetStatus: 'RUNNING'` への遷移時に必ず実行する `validateLessonForStart`（[functions/src/lessonRuns/phases/validation.ts](../../../functions/src/lessonRuns/phases/validation.ts)）は `lessonRun.templateSnapshot.phases`（フェーズグラフ）を検証するが、現在の教材作成UI（`TemplateEditorPage`/`GuidedBuilderWizard`）はこのフィールドを一切生成しない。そのため今日作られたどの教材でも「授業を開始」は必ず `NO_TERMINAL_PHASE` エラーで失敗する。

ユーザーの判断により、教材作成UIにフェーズ編集エディタを追加するのではなく、**LessonRun作成時に教材の `subject` から固定パターンのフェーズグラフを自動生成してサーバー側に保存する**方式を採る。生成される4フェーズは、既存のTIMED/SUBMISSION_BASED進行がバリデーションで要求する `durationSeconds`/`requiredCompletionRatio` の設定を避けるため、全て `TEACHER_CONTROLLED`（教師がボタンで手動進行）に統一する:

- 社会科（`SOCIAL_STUDIES`）: `intro` → `market` → `result` → `reflection`
- 家庭科（`HOME_ECONOMICS`）: `intro` → `decision` → `result` → `reflection`（`MARKET` タイプは家庭科教材で禁止されているため `DECISION` を使う）

`transitionPhaseCallable` は `targetStatus` と `targetPhaseId` を同一呼び出しで同時に指定できない設計になっている（既存の制約、変更しない）。そのため「授業を開始」は2回の呼び出し（`targetStatus: 'RUNNING'` → `targetPhaseId: 'intro'`）になり、「最終フェーズ（`result`）から`reflection`へ進む」も2回の呼び出し（`targetPhaseId: 'reflection'` → `targetStatus: 'REFLECTION'`）になる。それ以外のフェーズ間の「次へ進む」は `targetPhaseId` のみの1回呼び出しで良い（ステータスは `RUNNING` のまま変わらない）。

このフェーズグラフが「教材ごとに作者が定義したものではなく固定パターンである」という制約は、教材作成UIにフェーズ編集機能ができるまでの暫定措置であることをコード内のコメントで明記する。

**Tech Stack:** TypeScript, Firebase Admin SDK / Callable Functions（新規Callableは無し — 既存の `transitionPhaseCallable`/`transitionPhase` クライアントラッパーを再利用）, React + MUI

## Global Constraints

- `transitionPhaseCallable`/`LessonPhase`/`validateLessonForStart` 自体には手を加えない — 既に完成しテストされているバリデーションロジックを尊重し、これを満たすデータを供給する側だけを実装する
- 生成するフェーズグラフは4フェーズ固定。将来教材作成UIにフェーズエディタが追加されたら、この自動生成ロジックはテンプレート側で編集されたグラフで置き換えられる想定（このタスクではそこまで作らない）
- 各タスクの最後に `npm run typecheck`, `npm run lint`, 該当テストを実行する

---

## Task 1: バックエンド — `buildDefaultPhases`

**Files:**
- Create: `functions/src/lessonRuns/phases/defaultPhases.ts`
- Create: `functions/src/lessonRuns/phases/defaultPhases.test.ts`

**Interfaces:**
- Consumes: `LessonPhase`（既存, `./validation.ts`）
- Produces: `buildDefaultPhases(subject)`。Task 2 の `createLessonRun.ts` がこれを利用する

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/lessonRuns/phases/defaultPhases.test.ts
import { describe, expect, it } from 'vitest'
import { buildDefaultPhases } from './defaultPhases'
import { validateLessonForStart } from './validation'

describe('buildDefaultPhases', () => {
  it('produces a graph that passes validateLessonForStart for SOCIAL_STUDIES', () => {
    const { phases, initialPhaseId } = buildDefaultPhases('SOCIAL_STUDIES')
    const errors = validateLessonForStart({ subject: 'SOCIAL_STUDIES', phases, initialPhaseId }).filter((p) => p.severity === 'ERROR')
    expect(errors).toEqual([])
    expect(initialPhaseId).toBe('intro')
  })

  it('produces a graph that passes validateLessonForStart for HOME_ECONOMICS', () => {
    const { phases, initialPhaseId } = buildDefaultPhases('HOME_ECONOMICS')
    const errors = validateLessonForStart({ subject: 'HOME_ECONOMICS', phases, initialPhaseId }).filter((p) => p.severity === 'ERROR')
    expect(errors).toEqual([])
  })

  it('never includes a MARKET-type phase for HOME_ECONOMICS (矛盾解消G)', () => {
    const { phases } = buildDefaultPhases('HOME_ECONOMICS')
    expect(phases.some((phase) => phase.type === 'MARKET')).toBe(false)
  })

  it('ends in a REFLECTION-type terminal phase with no further transitions', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES')
    const reflection = phases.find((phase) => phase.id === 'reflection')
    expect(reflection?.type).toBe('REFLECTION')
    expect(reflection?.nextPhaseIds).toEqual([])
  })

  it('chains every phase to the next by id, forming a single linear path', () => {
    const { phases, initialPhaseId } = buildDefaultPhases('SOCIAL_STUDIES')
    expect(initialPhaseId).toBe('intro')
    expect(phases.find((phase) => phase.id === 'intro')?.nextPhaseIds).toEqual(['market'])
    expect(phases.find((phase) => phase.id === 'market')?.nextPhaseIds).toEqual(['result'])
    expect(phases.find((phase) => phase.id === 'result')?.nextPhaseIds).toEqual(['reflection'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/defaultPhases.test.ts`
Expected: FAIL — `Cannot find module './defaultPhases'`

- [ ] **Step 3: Write the implementation**

```ts
// functions/src/lessonRuns/phases/defaultPhases.ts
import type { LessonPhase } from './validation'

export interface DefaultPhaseGraph {
  phases: LessonPhase[]
  initialPhaseId: string
}

/**
 * Minimal, fixed 4-phase graph (intro -> subject-specific middle phase ->
 * result -> reflection), generated because no template-authoring UI in
 * this codebase produces a `phases` field yet (LessonContent has none) —
 * without this, `validateLessonForStart` always fails NO_TERMINAL_PHASE
 * and no lesson could ever start. Every phase uses TEACHER_CONTROLLED
 * progression so the teacher advances manually from Control Room, avoiding
 * the TIMED/SUBMISSION_BASED requirements (durationSeconds/
 * requiredCompletionRatio) a template author has no UI to configure.
 *
 * This is a deliberate placeholder for the real per-template phase graph a
 * future authoring-UI task would let teachers define — do not extend this
 * with more phase types/branches; if richer authoring is needed, build the
 * editor and stop calling this function for templates that have their own
 * `phases`.
 */
export const buildDefaultPhases = (subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'): DefaultPhaseGraph => {
  const middlePhase: LessonPhase = subject === 'SOCIAL_STUDIES'
    ? { id: 'market', type: 'MARKET', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['result'], displayConfig: { label: '取引' } }
    : { id: 'decision', type: 'DECISION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['result'], displayConfig: { label: '意思決定' } }

  const phases: LessonPhase[] = [
    { id: 'intro', type: 'INTRO', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [middlePhase.id], displayConfig: { label: '導入' } },
    middlePhase,
    { id: 'result', type: 'RESULT', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['reflection'], displayConfig: { label: '結果' } },
    { id: 'reflection', type: 'REFLECTION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [], displayConfig: { label: '振り返り' } },
  ]

  return { phases, initialPhaseId: 'intro' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/defaultPhases.test.ts`
Expected: PASS（全5テスト）

- [ ] **Step 5: Commit**

```bash
git add functions/src/lessonRuns/phases/defaultPhases.ts functions/src/lessonRuns/phases/defaultPhases.test.ts
git commit -m "feat(functions): add buildDefaultPhases producing a validation-passing default phase graph"
```

---

## Task 2: `createLessonRun` に自動生成したフェーズグラフを保存

**Files:**
- Modify: `functions/src/lessonRuns/createLessonRun.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.test.ts`

**Interfaces:**
- Consumes: `buildDefaultPhases`（Task 1）
- Produces: 新規 LessonRun の `templateSnapshot.phases`/`templateSnapshot.initialPhaseId` に、Task 1で生成したグラフが保存される

- [ ] **Step 1: Add a failing test**

`functions/src/lessonRuns/createLessonRun.test.ts` 冒頭の `makeFakeFirestore` ヘルパーと、既存テスト `'fixes the template snapshot and generates a randomSeed the caller never supplies'`（[functions/src/lessonRuns/createLessonRun.test.ts:80-95](../../../functions/src/lessonRuns/createLessonRun.test.ts:80)）と同じセットアップパターンで、その直後に追加する:

```ts
  it('attaches a default phase graph (phases/initialPhaseId) to templateSnapshot so the lesson can later transition to RUNNING', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'fixed-test-seed',
      generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-1',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })
    const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`) as { templateSnapshot: { phases: Array<{ id: string; type: string }>; initialPhaseId: string; title: string } }
    expect(run.templateSnapshot.initialPhaseId).toBe('intro')
    expect(run.templateSnapshot.phases.map((phase) => phase.id)).toEqual(['intro', 'market', 'result', 'reflection'])
    // The rest of the original template content must still be preserved, not replaced.
    expect(run.templateSnapshot.title).toBe('t')
  })

```

（HOME_ECONOMICS向けの `DECISION` 選択自体は Task 1 の `buildDefaultPhases` 単体テストで既に検証済み — `createLessonRun` 側は `contentSubject` を正しく `buildDefaultPhases` に渡していることをSOCIAL_STUDIESの1ケースで確認すれば十分で、HOME_ECONOMICS用の妥当な `content` フィクスチャ（`validateHomeEconomicsContent` が要求する多数の必須フィールドを持つ）をここで新たに組み立てる必要はない。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=functions -- src/lessonRuns/createLessonRun.test.ts`
Expected: FAIL — `templateSnapshot.phases` が未定義

- [ ] **Step 3: Wire `buildDefaultPhases` into the templateSnapshot write**

`functions/src/lessonRuns/createLessonRun.ts` の先頭 import群に追加:

```ts
import { buildDefaultPhases } from './phases/defaultPhases'
```

[functions/src/lessonRuns/createLessonRun.ts:178-184](../../../functions/src/lessonRuns/createLessonRun.ts:178) 付近の `tx.set(\`lessonRuns/${lessonRunId}\`, {...})` 呼び出しを変更する:

変更前:
```ts
    tx.set(`lessonRuns/${lessonRunId}`, {
      orgId: deps.orgId, templateId: deps.templateId, templateVersionId: template.currentPublishedVersionId,
      templateSnapshot: version.content, subject: (version.content as { subject: string }).subject,
      status: 'DRAFT', primaryTeacherUid: deps.primaryTeacherUid, teacherRoles: { [deps.primaryTeacherUid]: 'PRIMARY' },
      currentPhaseId: null, randomSeed, restoreGeneration: 0,
      startedAt: null, endedAt: null, createdAt: nowValue,
      maxParticipants: MAX_PARTICIPANTS, expectedParticipants: deps.expectedParticipants ?? null,
    })
```

変更後:
```ts
    const contentSubject = (version.content as { subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' }).subject
    const defaultPhaseGraph = buildDefaultPhases(contentSubject)
    tx.set(`lessonRuns/${lessonRunId}`, {
      orgId: deps.orgId, templateId: deps.templateId, templateVersionId: template.currentPublishedVersionId,
      templateSnapshot: {
        ...(version.content as Record<string, unknown>),
        phases: defaultPhaseGraph.phases,
        initialPhaseId: defaultPhaseGraph.initialPhaseId,
      },
      subject: contentSubject,
      status: 'DRAFT', primaryTeacherUid: deps.primaryTeacherUid, teacherRoles: { [deps.primaryTeacherUid]: 'PRIMARY' },
      currentPhaseId: null, randomSeed, restoreGeneration: 0,
      startedAt: null, endedAt: null, createdAt: nowValue,
      maxParticipants: MAX_PARTICIPANTS, expectedParticipants: deps.expectedParticipants ?? null,
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=functions -- src/lessonRuns/createLessonRun.test.ts`
Expected: PASS（全テスト。特に既存の `templateSnapshot: version.content` を厳密一致でアサートしていた既存テストがあれば、`phases`/`initialPhaseId` が追加された分だけ期待値を更新する）

- [ ] **Step 5: Run the functions workspace verify**

Run: `npm run verify --workspace=functions`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts
git commit -m "feat(functions): attach a default phase graph to every new LessonRun's templateSnapshot"
```

---

## Task 3: `LessonControlRoom` の `onAdvancePhase` に現在のフェーズIDを渡す

**Files:**
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces: `onAdvancePhase?: (currentPhaseId: string | null) => void`（シグネチャ変更）。Task 4 の `TeacherControlRoute` がこれを使って次に進むフェーズを決定する

- [ ] **Step 1: Update the failing test**

`src/components/teacher/LessonControlRoom.test.tsx` 内の、`onAdvancePhase` を検証している既存テストを確認する（`grep -n "onAdvancePhase" src/components/teacher/LessonControlRoom.test.tsx`）。呼び出しアサーションを `toHaveBeenCalledWith(<currentPhaseId>)` に更新する。既存テストが `emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })` のように状態を流し込んでいる場合、そのテストの `expect(onAdvancePhase).toHaveBeenCalled()` を `expect(onAdvancePhase).toHaveBeenCalledWith('phase-1')` に変更する。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/teacher/LessonControlRoom.test.tsx`
Expected: FAIL — `onAdvancePhase` が引数無しで呼ばれている

- [ ] **Step 3: Update the prop type and call site**

[src/components/teacher/LessonControlRoom.tsx:81](../../../src/components/teacher/LessonControlRoom.tsx:81):

変更前:
```ts
  /** Invoked when the primary CTA is "次のフェーズへ進む" (status RUNNING). Same phase-graph-knowledge reasoning as `onStartLesson`. */
  onAdvancePhase?: () => void
```

変更後:
```ts
  /**
   * Invoked when the primary CTA is "次のフェーズへ進む" (status RUNNING).
   * Receives this screen's own `publicState.currentPhaseId` — same
   * "only this component subscribes to lessonRunPublic" reasoning as
   * `onGenerateResults` (Phase 4). The caller is responsible for phase-
   * graph knowledge (which phase comes next, and whether that also
   * requires a status change) — this screen does not have it.
   */
  onAdvancePhase?: (currentPhaseId: string | null) => void
```

`nextAction` の算出（[src/components/teacher/LessonControlRoom.tsx:170-173](../../../src/components/teacher/LessonControlRoom.tsx:170) 付近）を変更する:

変更前:
```ts
    if (status === 'RUNNING' && onAdvancePhase) {
      return { label: advancePhaseLabel, onActivate: onAdvancePhase }
    }
```

変更後:
```ts
    if (status === 'RUNNING' && onAdvancePhase) {
      return { label: advancePhaseLabel, onActivate: () => onAdvancePhase(publicState?.currentPhaseId ?? null) }
    }
```

（`publicState` は同コンポーネント内で既に `useState<LessonRunPublicState | null>` として保持されている — [src/components/teacher/LessonControlRoom.tsx:120](../../../src/components/teacher/LessonControlRoom.tsx:120)。`useMemo` の依存配列に `publicState?.currentPhaseId` を追加すること。）

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/teacher/LessonControlRoom.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx
git commit -m "feat: pass currentPhaseId into onAdvancePhase so the caller can compute the next phase"
```

---

## Task 4: `TeacherControlRoute` に開始/進行ロジックを配線

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `transitionPhase`（既存, `src/lib/lessonRuns/transitionPhase.ts`）
- Produces: Control Roomの「授業を開始」「次のフェーズへ進む」ボタンが実際にレッスンを進行させる

- [ ] **Step 1: Add the import**

`src/App.tsx` の import群に追加:

```ts
import { transitionPhase } from './lib/lessonRuns/transitionPhase'
```

- [ ] **Step 2: Add the default-phase-sequence lookup and wire the handlers**

`TeacherControlRoute`（`grep -n "function TeacherControlRoute" src/App.tsx` で現在の行を確認）の直前に、Task 1のバックエンド生成ロジックと同じ並び順を表すフロントエンド側の小さな定数を追加する:

```ts
/**
 * Mirrors functions/src/lessonRuns/phases/defaultPhases.ts's fixed 4-phase
 * sequence — this hardcoded duplication is a deliberate, documented
 * placeholder (see that file's own JSDoc) until a real per-template phase
 * graph exists; Control Room has no other way to know "what phase comes
 * next" without fetching and walking templateSnapshot.phases itself.
 */
const defaultPhaseSequence = (subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined): string[] =>
  subject === 'HOME_ECONOMICS' ? ['intro', 'decision', 'result', 'reflection'] : ['intro', 'market', 'result', 'reflection']
```

`TeacherControlRoute` 本体を変更する:

変更前:
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
    onStartLesson={async () => {
      if (!runId) return
      await transitionPhase(services.functions, {
        lessonRunId: runId, targetStatus: 'RUNNING', reason: '教師操作: 授業開始', idempotencyKey: crypto.randomUUID(),
      })
      await transitionPhase(services.functions, {
        lessonRunId: runId, targetPhaseId: 'intro', reason: '教師操作: 授業開始', idempotencyKey: crypto.randomUUID(),
      })
    }}
    onAdvancePhase={async (currentPhaseId) => {
      if (!runId) return
      const sequence = defaultPhaseSequence(access.subject)
      const currentIndex = currentPhaseId ? sequence.indexOf(currentPhaseId) : -1
      const nextPhaseId = sequence[currentIndex + 1] ?? sequence[sequence.length - 1]
      await transitionPhase(services.functions, {
        lessonRunId: runId, targetPhaseId: nextPhaseId, reason: '教師操作: 次のフェーズへ進む', idempotencyKey: crypto.randomUUID(),
      })
      if (nextPhaseId === 'reflection') {
        await transitionPhase(services.functions, {
          lessonRunId: runId, targetStatus: 'REFLECTION', reason: '教師操作: 次のフェーズへ進む', idempotencyKey: crypto.randomUUID(),
        })
      }
    }}
  />
}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー

- [ ] **Step 4: Update `App.test.tsx`**

`src/App.test.tsx` に、`'grants a teacher whose uid is in teacherRoles and renders the control room'` テストの近くに追加する（`httpsCallableMock` に `'transitionPhaseCallable'` の分岐を追加してから使う）:

```ts
  it('calls transitionPhaseCallable twice (RUNNING then intro) when starting a lesson from the control room', async () => {
    window.history.pushState({}, '', '/teacher/lessons/run-1/control')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ orgId: 'org-1', teacherRoles: { 'teacher-uid': 'PRIMARY' } }) })
    const transitionCalls: unknown[] = []
    httpsCallableMock.mockImplementation((_functions: unknown, name: string) => {
      if (name === 'transitionPhaseCallable') {
        return vi.fn((input: unknown) => { transitionCalls.push(input); return Promise.resolve({ data: { status: 'RUNNING', currentPhaseId: 'intro', deduplicated: false } }) })
      }
      return callableMock
    })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid' })
    const user = userEvent.setup()
    const startButton = await screen.findByRole('button', { name: '授業を開始' })
    await user.click(startButton)
    await waitFor(() => expect(transitionCalls).toHaveLength(2))
    expect(transitionCalls[0]).toEqual(expect.objectContaining({ lessonRunId: 'run-1', targetStatus: 'RUNNING' }))
    expect(transitionCalls[1]).toEqual(expect.objectContaining({ lessonRunId: 'run-1', targetPhaseId: 'intro' }))
    window.history.pushState({}, '', '/')
  })
```

（`'授業を開始'` というボタンラベルは `LessonControlRoom` の `startLessonLabel` prop のデフォルト値を前提にしている — 実装者は編集前に [src/components/teacher/LessonControlRoom.tsx](../../../src/components/teacher/LessonControlRoom.tsx) の `startLessonLabel` のデフォルト文言を確認し、実際のラベル文字列に合わせること。）

- [ ] **Step 5: Run the test file**

Run: `npm test -- src/App.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire onStartLesson/onAdvancePhase in TeacherControlRoute using the default phase sequence"
```

---

## Task 5: Phase 6完了確認

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: lint, typecheck, tests, rules, market concurrency, build すべてPASS

- [ ] **Step 2: Manual end-to-end smoke test**

1. `npm run dev` でローカル起動
2. Phase 1のフローで新しい授業を作成し、`/teacher/lessons/{runId}/control` に到達
3. 「授業を開始」ボタンを押し、エラーにならず `status` が `RUNNING`、`currentPhaseId` が `intro` になることを確認（Phase 2の生徒側 `/waiting` が自動的に `/play` へ遷移することも合わせて確認できる）
4. 「次のフェーズへ進む」を押すたびに `market`/`decision` → `result` → `reflection` と進み、`reflection` に到達した時点で `status` が `REFLECTION` に変わり、Phase 4の「結果を生成する」ボタンが表示されることを確認
5. Phase 3の生徒側 `/play` が `REFLECTION` への遷移で自動的に `/results` へ移動することも確認

- [ ] **Step 3: Update the roadmap**

[docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md](2026-08-17-production-readiness-roadmap.md) の "Phase 6" セクションに完了マークを付け、フェーズグラフが固定パターンの暫定実装であることを明記する。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md
git commit -m "docs: mark Phase 6 complete in production readiness roadmap (default phase graph is a documented placeholder)"
```
