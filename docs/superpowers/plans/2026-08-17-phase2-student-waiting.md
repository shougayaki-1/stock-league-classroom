# Phase 2: 生徒導線 — 参加者情報の伝搬 + 待機画面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 生徒が参加コードで参加した後の `/lessons/:runId/waiting` を、現在の `DeferredDataNotice`（プレースホルダー）から実際の `LessonWaitingPage` に接続する。授業タイトル・自チーム名・自分の表示名を実データで表示し、教師が授業を開始（`status` が `RUNNING`）した瞬間に自動的に `/lessons/:runId/play` へ遷移させる。

**Architecture:** 調査の結果、生徒がアクセスできるRTDBノード（`lessonRunMembership`/`lessonRunPublic`/`lessonRunTeamState`）のどこにも「授業タイトル」「チーム表示名」が投影されていないことが判明した。これはバックエンドの `LessonRunProjectionSource`（`title`・`teams[].displayName` を既に保持している）から `LessonRunPublicState`（生徒に配信される公開ノード）への出力に、その2フィールドが今まで含まれていなかっただけ — 新しいデータソースは不要で、既存のallow-listプロジェクション関数に2フィールド追加するだけで済む。`participantId` も同様に、既存の `lessonRunMembership` ミラーに元々含まれているのに `useStudentLessonAccess` が読み捨てていただけと判明した。唯一サーバー側に存在しない情報は生徒本人の `displayName`（生徒が参加画面で入力した値がどこにも永続化されない）で、これだけは React Router の `location.state` で `/join` → `/waiting` 間を橋渡しする。

**Tech Stack:** React + TypeScript, MUI, React Router, Firebase RTDB (`onValue`/`ref`), Vitest + @testing-library/react (frontend), Vitest (functions)

## Global Constraints

- `LessonRunPublicState` は生徒全員に配信される共有ノード（RTDB全体読み取り制御しかできない）なので、新規追加フィールドは必ずallow-list方式で明示的に列挙する — `source` オブジェクトを絶対にスプレッドしない（[functions/src/lessonRuns/projections/publicProjection.ts](../../../functions/src/lessonRuns/projections/publicProjection.ts) 冒頭のセキュリティコメントに明記された既存の設計原則）
- サーバー側 `LessonRunPublicState`（`functions/src/lessonRuns/projections/publicProjection.ts`）とクライアント側の手動複製 `LessonRunPublicState`（`src/lib/lessonRuns/liveTypes.ts`）は「Keep both in sync by hand」という既存の運用規約に従う — 型を変更するときは必ず両方を同時に変更する
- 復帰コード（`recoveryCode`）とチームメンバー名一覧（`teamMemberNames`）は、生徒が読める経路がまだ存在しないため、本フェーズのスコープ外として `undefined` のまま残す（`LessonWaitingPage` はどちらもoptional prop なので描画は壊れない）
- 各タスクの最後に `npm run typecheck`, `npm run lint`, 該当テストを実行する

---

## Task 1: バックエンド — `LessonRunPublicState` に `title`/`teams` を追加投影

**Files:**
- Modify: `functions/src/lessonRuns/projections/publicProjection.ts`
- Modify: `functions/src/lessonRuns/projections/publicProjection.test.ts`

**Interfaces:**
- Consumes: 既存の `LessonRunProjectionSource`（[functions/src/lessonRuns/projections/source.ts:30-53](../../../functions/src/lessonRuns/projections/source.ts:30)）— 既に `title: string` と `teams: LessonRunProjectionTeamSource[]`（各要素は `id`/`displayName` を含む）を保持している。新しいソースの追加は不要
- Produces: `LessonRunPublicState` に `title: string` と `teams: LessonRunPublicTeamSummary[]`（新規エクスポート型、`{ teamId: string; displayName: string }`）が追加される。Task 2（クライアント型）・Task 5（`StudentWaitingRoute`）がこれを利用する

- [x] **Step 1: Update the existing test fixture assertion (this will fail first, then be made to pass)**

`functions/src/lessonRuns/projections/publicProjection.test.ts` の `'projects status/phase/remaining-time/publicTask/notifications only'` テストを次のように変更する（[functions/src/lessonRuns/projections/publicProjection.test.ts:57-70](../../../functions/src/lessonRuns/projections/publicProjection.test.ts:57) 付近）:

変更前:
```ts
  it('projects status/phase/remaining-time/publicTask/notifications only', () => {
    const publicState = toLessonRunPublicState(privateRunFixture, 6_000)
    expect(publicState).toEqual({
      status: 'RUNNING',
      currentPhaseId: 'phase-2',
      updatedAtMillis: 5_000,
      orgId: 'org-1',
      remainingPhaseSeconds: 4,
      publicTask: '来週の株価を予想してください',
      notifications: [
        { id: 'evt-1', type: 'PHASE_CHANGED', severity: 'IMPORTANT', occurredAtMillis: 4_000 },
        { id: 'evt-2', type: 'RESPONSE_SAVED', severity: 'REFERENCE', occurredAtMillis: 4_500 },
      ],
    })
  })
```

変更後:
```ts
  it('projects status/phase/remaining-time/publicTask/notifications/title/teams only', () => {
    const publicState = toLessonRunPublicState(privateRunFixture, 6_000)
    expect(publicState).toEqual({
      status: 'RUNNING',
      currentPhaseId: 'phase-2',
      updatedAtMillis: 5_000,
      orgId: 'org-1',
      remainingPhaseSeconds: 4,
      publicTask: '来週の株価を予想してください',
      notifications: [
        { id: 'evt-1', type: 'PHASE_CHANGED', severity: 'IMPORTANT', occurredAtMillis: 4_000 },
        { id: 'evt-2', type: 'RESPONSE_SAVED', severity: 'REFERENCE', occurredAtMillis: 4_500 },
      ],
      title: '株式投資シミュレーション',
      teams: [{ teamId: 'team-a', displayName: 'Aチーム' }],
    })
  })

  it('never leaks per-team publicAggregateLabel, individualResponses, or unsubmittedParticipantIds through the new teams field', () => {
    const publicState = toLessonRunPublicState(privateRunFixture, 6_000)
    const serialized = JSON.stringify(publicState)
    expect(serialized).not.toContain('publicAggregateLabel')
    expect(serialized).not.toContain('1位')
  })
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=functions -- src/lessonRuns/projections/publicProjection.test.ts`
Expected: FAIL — `title`/`teams` は `undefined`、実際のオブジェクトに存在しないため `toEqual` が不一致

- [x] **Step 3: Update `LessonRunPublicState` interface and `toLessonRunPublicState`**

`functions/src/lessonRuns/projections/publicProjection.ts` の `LessonRunPublicState` interface（[functions/src/lessonRuns/projections/publicProjection.ts:24-31](../../../functions/src/lessonRuns/projections/publicProjection.ts:24)）を次のように変更する:

変更前:
```ts
export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
  orgId: string
  remainingPhaseSeconds: number | null
  publicTask: string | null
  notifications: LessonRunPublicNotification[]
}
```

変更後:
```ts
/** Allow-listed per-team summary safe for the whole-class-broadcast node — teamId/displayName only, never publicAggregateLabel/individualResponses/unsubmittedParticipantIds (those stay on LessonRunDisplayState, the projector-only node). */
export interface LessonRunPublicTeamSummary {
  teamId: string
  displayName: string
}

export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
  orgId: string
  remainingPhaseSeconds: number | null
  publicTask: string | null
  notifications: LessonRunPublicNotification[]
  title: string
  teams: LessonRunPublicTeamSummary[]
}
```

`toLessonRunPublicState` 関数本体（[functions/src/lessonRuns/projections/publicProjection.ts:44-56](../../../functions/src/lessonRuns/projections/publicProjection.ts:44)）を次のように変更する:

変更前:
```ts
export const toLessonRunPublicState = (source: LessonRunProjectionSource, nowMillis: number): LessonRunPublicState => ({
  status: source.status,
  currentPhaseId: source.currentPhaseId,
  updatedAtMillis: source.updatedAtMillis,
  orgId: source.orgId,
  remainingPhaseSeconds: remainingSeconds(source.currentPhaseEndsAtMillis, nowMillis),
  publicTask: source.currentPhasePublicTask,
  notifications: source.recentNotifications.map((event) => ({
    id: event.id,
    type: event.type,
    severity: classifyNotification(event.type),
    occurredAtMillis: event.occurredAtMillis,
  })),
})
```

変更後:
```ts
export const toLessonRunPublicState = (source: LessonRunProjectionSource, nowMillis: number): LessonRunPublicState => ({
  status: source.status,
  currentPhaseId: source.currentPhaseId,
  updatedAtMillis: source.updatedAtMillis,
  orgId: source.orgId,
  remainingPhaseSeconds: remainingSeconds(source.currentPhaseEndsAtMillis, nowMillis),
  publicTask: source.currentPhasePublicTask,
  notifications: source.recentNotifications.map((event) => ({
    id: event.id,
    type: event.type,
    severity: classifyNotification(event.type),
    occurredAtMillis: event.occurredAtMillis,
  })),
  title: source.title,
  teams: source.teams.map((team) => ({ teamId: team.id, displayName: team.displayName })),
})
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=functions -- src/lessonRuns/projections/publicProjection.test.ts`
Expected: PASS（全テスト、既存の「forbidden information」テスト群も含む）

- [x] **Step 5: Run the functions workspace verify**

Run: `npm run verify --workspace=functions`
Expected: PASS（`publicProjection.ts` を消費する他のテスト、例えば `publishLessonProjectionWithAdminSdk` の regression テストも壊れていないことを確認）

- [x] **Step 6: Commit**

```bash
git add functions/src/lessonRuns/projections/publicProjection.ts functions/src/lessonRuns/projections/publicProjection.test.ts
git commit -m "feat(functions): project lesson title and team display names onto the public RTDB state"
```

---

## Task 2: フロントエンド型定義の同期

**Files:**
- Modify: `src/lib/lessonRuns/liveTypes.ts`

**Interfaces:**
- Consumes: なし（型定義のみ）
- Produces: クライアント側 `LessonRunPublicState` に `title`/`teams` が追加され、Task 5 の `StudentWaitingRoute` で型安全に利用できる

- [x] **Step 1: Add the fields to the client-side type**

`src/lib/lessonRuns/liveTypes.ts` の `LessonRunPublicState` interface（79行目付近、`notifications: LessonRunPublicNotification[]` の直後）に追加:

```ts
  /** Lesson title, safe for every participant (see functions/src/lessonRuns/projections/publicProjection.ts's toLessonRunPublicState — kept in sync by hand). */
  title: string
  /** Allow-listed per-team summary — teamId/displayName only. A student resolves their own team's displayName by matching against their own membership mirror's teamId. */
  teams: LessonRunPublicTeamSummary[]
```

同ファイルの `LessonRunPublicNotification` interfaceの直前あたりに新しい型を追加する:

```ts
export interface LessonRunPublicTeamSummary {
  teamId: string
  displayName: string
}
```

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0エラー（この時点では `LessonRunPublicState` を消費するコードがまだ無いので影響なし。もし既存の `subscribePublicRun` の戻り値を使うテスト等で `toEqual` の厳密比較が壊れる場合は該当テストのフィクスチャに `title`/`teams` を追加する — Step 3で確認）

- [x] **Step 3: Run the full frontend test suite to catch any fixture drift**

Run: `npm test`
Expected: PASS。もし `LessonRunPublicState` 型を使う既存のテストフィクスチャで型エラーが出た場合、そのフィクスチャに `title: '...'` と `teams: []` を追加する

- [x] **Step 4: Commit**

```bash
git add src/lib/lessonRuns/liveTypes.ts
git commit -m "feat: sync client LessonRunPublicState with title/teams fields added on the server"
```

---

## Task 3: `participantId` をミラーから取得できるようにする

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: 既存の `lessonRunMembership/{runId}/{uid}` RTDBミラー（`LessonRunMembershipMirror` は既に `participantId` を持っている — サーバー側は変更不要）
- Produces: `StudentAccess.participantId: string | undefined`。今回のフェーズでは未使用だが、Phase 4（結果取得）で生徒本人の結果を絞り込むために必須になる値なので、ここで取得経路だけ先に通しておく

- [x] **Step 1: Widen the `StudentAccess` type**

[src/App.tsx:131](../../../src/App.tsx:131):

変更前:
```ts
interface StudentAccess { status: AccessStatus; teamId?: string }
```

変更後:
```ts
interface StudentAccess { status: AccessStatus; teamId?: string; participantId?: string }
```

- [x] **Step 2: Parse `participantId` out of the membership snapshot**

`useStudentLessonAccess` 内の `onValue` コールバック（[src/App.tsx:200-203](../../../src/App.tsx:200) 付近）を変更する:

変更前:
```ts
          (snapshot: { val: () => unknown }) => {
            if (cancelled) return
            const value = snapshot.val() as { access?: string; teamId?: string } | null
            setAccess(value?.access === 'ACTIVE' ? { status: 'GRANTED', teamId: value.teamId } : { status: 'DENIED' })
          },
```

変更後:
```ts
          (snapshot: { val: () => unknown }) => {
            if (cancelled) return
            const value = snapshot.val() as { access?: string; teamId?: string; participantId?: string } | null
            setAccess(value?.access === 'ACTIVE' ? { status: 'GRANTED', teamId: value.teamId, participantId: value.participantId } : { status: 'DENIED' })
          },
```

- [x] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー

- [x] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: expose participantId from the existing lessonRunMembership mirror subscription"
```

---

## Task 4: `displayName` をJoin画面から待機画面へ伝搬

**Files:**
- Modify: `src/components/student/LessonJoinPage.tsx`
- Modify: `src/components/student/LessonJoinPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `LessonJoinPage` が既に内部で保持している `displayName` フォーム状態
- Produces: `onJoined` コールバックのシグネチャが `(result: JoinLessonRunResult, displayName: string) => void` に変わる。`JoinRoute` がこれを使って `navigate` の `state` に `displayName` を積む。Task 5 の `StudentWaitingRoute` が `useLocation().state` からこれを読む

- [x] **Step 1: Update the failing test first**

`src/components/student/LessonJoinPage.test.tsx` の該当テスト（[src/components/student/LessonJoinPage.test.tsx:35-50](../../../src/components/student/LessonJoinPage.test.tsx:35) 付近）を変更する:

変更前:
```ts
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(
      expect.objectContaining({ lessonRunId: 'run-1', participantId: 'p-1', duplicateIdentifierWarning: true }),
    ))
```

変更後:
```ts
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(
      expect.objectContaining({ lessonRunId: 'run-1', participantId: 'p-1', duplicateIdentifierWarning: true }),
      'たなか',
    ))
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/student/LessonJoinPage.test.tsx`
Expected: FAIL — `onJoined` はまだ1引数でしか呼ばれていない

- [x] **Step 3: Update `LessonJoinPage` to pass `displayName` to `onJoined`**

`src/components/student/LessonJoinPage.tsx` の型定義（29-39行目付近）を変更する:

変更前:
```ts
export interface LessonJoinPageProps {
```
(内部の) 
```ts
  onJoined: (result: JoinLessonRunResult) => void
```

変更後:
```ts
  onJoined: (result: JoinLessonRunResult, displayName: string) => void
```

`onJoined(result)` の呼び出し箇所（[src/components/student/LessonJoinPage.tsx:72](../../../src/components/student/LessonJoinPage.tsx:72) 付近）を変更する:

変更前:
```ts
      onJoined(result)
```

変更後:
```ts
      onJoined(result, displayName.trim())
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/student/LessonJoinPage.test.tsx`
Expected: PASS（全テスト）

- [x] **Step 5: Wire `JoinRoute` to carry `displayName` via router state**

`src/App.tsx` の `JoinRoute`（[src/App.tsx:1306-1309](../../../src/App.tsx:1306) 付近）を変更する:

変更前:
```ts
  return <LessonJoinPage
    functions={services.functions}
    onJoined={(result) => navigate(`/lessons/${result.lessonRunId}/waiting`)}
  />
```

変更後:
```ts
  return <LessonJoinPage
    functions={services.functions}
    onJoined={(result, displayName) => navigate(`/lessons/${result.lessonRunId}/waiting`, { state: { displayName } })}
  />
```

- [x] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー

- [x] **Step 7: Commit**

```bash
git add src/components/student/LessonJoinPage.tsx src/components/student/LessonJoinPage.test.tsx src/App.tsx
git commit -m "feat: carry the student's typed displayName from join to the waiting route via router state"
```

---

## Task 5: `StudentWaitingRoute` — 待機画面の実データ接続 + 自動遷移

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `subscribePublicRun`（既存, `src/lib/lessonRuns/liveRepository.ts`）, `LessonRunPublicState`/`LessonRunPublicTeamSummary`（Task 1/2で拡張済み）, `useStudentLessonAccess`/`StudentAccess`（Task 3で拡張済み）, `LessonWaitingPage`（既存, `src/components/student/LessonWaitingPage.tsx`）, `useLocation`（既存import）
- Produces: `/lessons/:runId/waiting` が実際に生徒本人のデータで `LessonWaitingPage` を描画する。`status` が `'RUNNING'` になった時点で自動的に `/lessons/:runId/play` へ遷移する

- [x] **Step 1: Add the `subscribePublicRun`/`LessonRunPublicState` imports**

`src/App.tsx` の既存import（[src/App.tsx:20](../../../src/App.tsx:20)）を変更する:

変更前:
```ts
import { subscribeOwnTeamState } from './lib/lessonRuns/liveRepository'
```

変更後:
```ts
import { subscribeOwnTeamState, subscribePublicRun } from './lib/lessonRuns/liveRepository'
import type { LessonRunPublicState } from './lib/lessonRuns/liveTypes'
```

- [x] **Step 2: Add the `StudentWaitingRoute` component**

`StudentLessonRoute` 関数の直後（[src/App.tsx:1246](../../../src/App.tsx:1246) 付近、`type HouseholdModeStatus = 'LOADING' | 'YES' | 'NO'` の直前）に新しい関数を追加する:

```tsx
/**
 * `/lessons/:runId/waiting` only. `StudentLessonRoute` keeps its
 * `DeferredDataNotice` fallback for `/results` unchanged (Phase 4 wires
 * that up once a student-scoped results-read path exists).
 *
 * `displayName` comes from `location.state` (set by `JoinRoute` right after
 * a successful join) because no server-readable path currently persists
 * it — a page reload or a reconnect via a different route loses it. This
 * is a known, deliberate gap: reconnect UX for displayName is out of scope
 * for this phase (see the roadmap's Phase 2 section).
 */
function StudentWaitingRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const access = useStudentLessonAccess(runId ?? '', services)
  const [publicState, setPublicState] = useState<LessonRunPublicState | null>(null)

  useEffect(() => {
    if (!runId) return
    return subscribePublicRun(services.database, runId, setPublicState)
  }, [runId, services])

  useEffect(() => {
    if (publicState?.status === 'RUNNING' && runId) navigate(`/lessons/${runId}/play`, { replace: true })
  }, [publicState?.status, runId, navigate])

  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/join" />
  if (!publicState) return <GuardLoading />

  const displayName = (location.state as { displayName?: string } | null)?.displayName ?? '(表示名不明)'
  const teamName = access.teamId ? publicState.teams.find((team) => team.teamId === access.teamId)?.displayName : undefined

  return <LessonWaitingPage lessonTitle={publicState.title} displayName={displayName} teamName={teamName} />
}
```

- [x] **Step 3: Add the `LessonWaitingPage` import**

`src/App.tsx` の `./components/student/...` インポート群に追加（該当するimportがまだ無いことを確認してから追加）:

```ts
import { LessonWaitingPage } from './components/student/LessonWaitingPage'
```

- [x] **Step 4: Wire the new route into `AppRoutes`**

[src/App.tsx:1339](../../../src/App.tsx:1339):

変更前:
```tsx
  <Route path="/lessons/:runId/waiting" element={enabled && services ? <StudentLessonRoute services={services} heading="開始をお待ちください" /> : <Navigate replace to="/about" />} />
```

変更後:
```tsx
  <Route path="/lessons/:runId/waiting" element={enabled && services ? <StudentWaitingRoute services={services} /> : <Navigate replace to="/about" />} />
```

（`/results` ルートの `<StudentLessonRoute services={services} heading="結果" />` はPhase 4まで変更しない。）

- [x] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー

- [x] **Step 6: Manual end-to-end smoke test**

1. `npm run dev` でローカル起動
2. Phase 1で作成した授業開始フローで新しい授業を開始（`/teacher/lessons/{runId}/control` に到達することを確認）
3. 別タブ（またはシークレットウィンドウ）で `/join` を開き、その授業の参加コードと表示名を入力して参加する
4. `/lessons/{runId}/waiting` に遷移し、授業タイトル・自分の表示名・自チーム名（教師が既にチーム分けを実行済みの場合）が表示されることを確認
5. Control Room側でこのlessonRunの `status` を `RUNNING` に進める操作を行い（既存の教師側フローに従う）、待機中のタブが自動的に `/lessons/{runId}/play` に遷移することを確認

- [x] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire /lessons/:runId/waiting to real lesson data and auto-navigate to /play once RUNNING"
```

---

## Task 6: Phase 2完了確認

- [x] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: lint, typecheck, tests, rules, market concurrency, build すべてPASS

- [x] **Step 2: Update the roadmap**

[docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md](2026-08-17-production-readiness-roadmap.md) の "Phase 2" セクションに完了マークを付け、次のセクションに以下を追記する:

> **Phase 2完了時点の既知の制約（次フェーズへの引き継ぎ）:**
> - `displayName` はページリロード/再接続で失われる（`location.state` 頼み）。恒久対応にはサーバー側での永続化とRTDB投影が必要 — Phase 18の「再接続UX」で扱う
> - `teamMemberNames`（自チームメンバー名一覧）と `recoveryCode`（復帰コード自己確認）はまだ生徒が読める経路が無く、`LessonWaitingPage` には渡していない

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md
git commit -m "docs: mark Phase 2 complete in production readiness roadmap"
```
