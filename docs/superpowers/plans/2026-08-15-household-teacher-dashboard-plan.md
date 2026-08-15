# 家庭科・教師用授業運用ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` task-by-task. Before any completion claim, use `superpowers:verification-before-completion`.

**Goal:** `HOME_ECONOMICS` / `COMMON_CONDITIONS` の授業で、教師が既存 `/teacher/lessons/:runId/control` から全家庭の状況確認、個別/一括/明示的強制決算、手動/自動チェックポイント、全家庭復元を安全に行えるようにする。

**Architecture:** Firestore の `HouseholdState`・意思決定・`ROUND_SETTLED` event を正本にする。教師画面は新しい server-authoritative dashboard Callable から allow-list 済み運用ビューだけを取得し、`lessonRunPrivate` を通常UIの読取元にしない。一括決算は server-only operation record + lease + per-household status で管理する。Checkpoint v2 は全家庭 Firestore state と、その時点の safe `HouseholdStateTeamView` を保存する。Restore は全 `HouseholdState` を1 Firestore transactionで戻し、その後 RTDB safe projection を再試行可能に同期する。

**Tech Stack:** TypeScript, React, MUI, Firebase Cloud Functions v2, Firestore Admin SDK, RTDB Admin SDK, Firebase client SDK, Vitest, React Testing Library, Firebase Emulator rules tests.

**Design source:** `docs/superpowers/specs/2026-08-15-household-teacher-dashboard-design.md`

## Global Constraints

1. 今回の操作対象は `HOME_ECONOMICS` + `COMMON_CONDITIONS` のみ。`ROLE_VARIANT` / `STAGE_SPLIT` / `MULTI_PERSON_PER_TEAM` は未対応表示に留める。
2. 教師 Callable の順序は `auth → scalar validation → LessonRun read → teacherRoles → active org membership → subordinate reads`。権限確定前に household/decision/event/checkpoint/operation を読まない。
3. クライアントから householdIds、team list、submitted state、reference state、team projection を受け取らない。対象はサーバーで列挙する。
4. Dashboard response に `randomSeed`、`internalRiskFactors`、`internalClaimProbability`、private coefficients、未公開イベント、private computation log 全体を含めない。
5. `lessonRunPrivate` の client read 権限を広げない。既存 `lessonRunPublic` / `lessonRunTeamState` / `lessonRunPrivate` の visibility 分離を維持する。
6. Firestore transaction は全 read を全 write より先に行う。`appendLessonEventInTransaction` の内部 read 後に追加 read をしない。
7. 重要操作は `idempotencyDocumentId` + `requestDigest` を使う。同一 key/same payload は replay、same key/different payload は `failed-precondition`。
8. Bulk operation は lease を持ち、success item を retry で再処理しない。
9. 通常一括決算は未提出が1件でもあれば household/checkpoint mutation 前に止める。operation metadata の失敗記録は許容する。
10. 強制決算は別の明示操作。未提出家庭だけ forced とし、`ROUND_SETTLED.payload.forcedSettlement` に監査情報を残す。
11. Duplicate settlement の CAS が no-op なら stale result を RTDB publish しない。
12. 新UIで復元できるのは checkpoint v2 + `scope='ALL_HOUSEHOLDS'` のみ。v1 はデコード互換だけ残す。
13. Restore 前に PRE_RESTORE checkpoint を同一 restore request につき1回だけ作る。
14. Restore は decision history を消さない。
15. RTDB restore sync は retryable。Firestore restore commit を二重実行せず projection のみ再試行できるようにする。
16. SOCIAL_STUDIES では Household dashboard Callable を呼ばない。
17. `HouseholdRoundControlPanel` など無関係な既存コードはこの計画では削除しない。
18. 各タスクは fail test → failure確認 → minimal implementation → pass確認 → commit の順で進める。

## Canonical Contracts

```ts
export interface HouseholdTeacherDashboard {
  lessonRunId: string
  subject: 'HOME_ECONOMICS'
  courseFormat: 'COMMON_CONDITIONS'
  restoreGeneration: number
  currentRoundIndex: number | null
  householdsAligned: boolean
  updatedAtServerMillis: number
  households: HouseholdTeacherRow[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
}

export interface HouseholdTeacherRow {
  householdId: string
  teamId: string
  teamDisplayName: string
  lifeStage: string
  roundIndex: number
  submittedForRoundIndex: boolean
  submittedAtServerMillis: number | null
  lastSettledRoundIndex: number | null
  cashYen: number
  assetHoldingsYen: Record<string, number>
  totalAssetsYen: number
  activeInsuranceContracts: Record<string, number>
  activeLiabilities: Record<string, { remainingPrincipalYen: number; remainingYears: number }>
  lastSettlementSummary: {
    roundIndex: number
    incomeYen: number
    expensesYen: number
    netCashFlowYen: number
    shortfallYen: number
    insuranceBenefitsYen: number
  } | null
  goalDelayedRounds: number
  revealedEvents: Array<{ eventId: string; label: string | null; effectDescription: string | null }>
  warnings: Array<{
    severity: 'ACTION_REQUIRED' | 'WARNING' | 'INFO'
    code: string
    message: string
  }>
}

export interface HouseholdCheckpointManifest {
  checkpointId: string
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  expectedRoundIndex: number | null
  createdAtServerMillis: number
  createdByUid: string
  restoreGeneration: number
}

export interface ProcessHouseholdRoundBatchRequest {
  lessonRunId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  idempotencyKey: string
}

export interface RetryHouseholdRoundBatchRequest {
  lessonRunId: string
  operationId: string
}

export type HouseholdBulkOperationStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED'
export type HouseholdBulkItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'

export interface HouseholdBulkSettlementOperationView {
  operationId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  status: HouseholdBulkOperationStatus
  preSettlementCheckpointId: string | null
  households: Record<string, {
    status: HouseholdBulkItemStatus
    errorCode?: string
    errorMessage?: string
  }>
  updatedAtServerMillis: number
}

export interface HouseholdCheckpointSnapshotV2 {
  schemaVersion: 2
  scope: 'ALL_HOUSEHOLDS'
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  createdAtServerMillis: number
  createdByUid: string
  expectedRoundIndex: number | null
  householdIds: string[]
  households: HouseholdState[]
  teamViews: Record<string, HouseholdStateTeamView>
}
```

## Agent Assignment and Parallelism

- **Task 1 — Claude:** COMMON_CONDITIONS 初期化共通化 + 単体決算安全化
- **Task 2 — Codex:** Bulk operation repository + lease
- **Task 3 — Claude:** Checkpoint v2 core
- **Task 4 — Codex:** Teacher dashboard server core
- **Task 5 — Claude:** Bulk settlement server core
- **Task 6 — Codex:** Atomic restore server core
- **Task 7 — Claude:** Callable wiring + Functions exports + client wrappers
- **Task 8 — Codex:** HouseholdTeacherDashboard UI
- **Task 9 — Claude:** App / LessonControlRoom integration
- **Task 10 — Codex:** Rules, acceptance, backlog, full verification

Dependency waves:

- **Wave 1:** Task 1 and Task 2 in parallel
- **Wave 2:** Task 3 after Tasks 1–2
- **Wave 3:** Tasks 4, 5, 6 in parallel after Task 3. These tasks must not edit `onCall.ts` or `functions/src/index.ts`.
- **Wave 4:** Task 7 after Tasks 4–6
- **Wave 5:** Task 8 after Task 7
- **Wave 6:** Task 9 after Task 8
- **Wave 7:** Task 10 after all prior tasks

---

## Task 1: COMMON_CONDITIONS initialization and single-household settlement safety

**Owner:** Claude

**Files:**
- Create: `functions/src/homeEconomics/commonConditionsHousehold.ts`
- Create: `functions/src/homeEconomics/commonConditionsHousehold.test.ts`
- Modify: `functions/src/lessonRuns/households/repository.ts`
- Modify: `functions/src/lessonRuns/households/repository.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/homeEconomics/processRound.ts`
- Modify: `functions/src/homeEconomics/processRound.test.ts`

**Consumes:** `HomeEconomicsContent`, `HouseholdState`, existing lazy initialization and `processRound`.

**Produces:** shared initial-state builder, shared COMMON_CONDITIONS initializer, explicit duplicate-settlement result, forced-settlement audit.

### 1.1 Extract exact current initial state

- [ ] Add a failing repository test for current initial state values.
- [ ] Run `npm --prefix functions test -- src/lessonRuns/households/repository.test.ts`; verify failure.
- [ ] Add this pure helper and make `getOrInitHouseholdState` use it:

```ts
export interface BuildInitialHouseholdStateInput {
  lessonRunId: string
  teamId: string
  householdId: string
  startingCashYen: number
  startingLifeStage: string
  nowMillis: number
}

export const buildInitialHouseholdState = (input: BuildInitialHouseholdStateInput): HouseholdState => ({
  householdId: input.householdId,
  lessonRunId: input.lessonRunId,
  teamId: input.teamId,
  cashYen: input.startingCashYen,
  assetHoldingsYen: {},
  activeInsuranceContracts: {},
  activeLiabilities: {},
  lifeStage: input.startingLifeStage,
  roundIndex: 0,
  goalDelayedRounds: 0,
  updatedAtServerMillis: input.nowMillis,
})
```

- [ ] Re-run repository test; verify pass.

### 1.2 Centralize COMMON_CONDITIONS profile resolution

- [ ] Add failing tests for COMMON_CONDITIONS+1 profile success, other format rejection, profile count mismatch rejection, preview no-write, ensure idempotency.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/commonConditionsHousehold.test.ts`; verify failure.
- [ ] Implement `previewCommonConditionsHouseholdState(...)` using `profile.cashSavingsYen` and `profile.lifeStage`, with `householdId === teamId`.
- [ ] Implement `ensureCommonConditionsHouseholdStateWithAdminSdk(lessonRunId, teamId)` using `getOrInitHouseholdState`.
- [ ] In student submit path keep `requireTeamMembership` before calling the shared ensure helper. Do not weaken authorization.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/commonConditionsHousehold.test.ts src/homeEconomics/onCall.test.ts`; verify pass.

### 1.3 Make duplicate settlement explicit

- [ ] Add failing tests proving a CAS miss does not publish RTDB and returns authoritative current HouseholdState.
- [ ] Add failing audit tests for forced missing-decision settlement versus submitted decision.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/processRound.test.ts`; verify failure.
- [ ] Change contracts to:

```ts
export type CommitRoundSettlementResult =
  | { status: 'COMMITTED' }
  | { status: 'ALREADY_SETTLED'; householdState: HouseholdState }

export type ProcessRoundExecutionResult =
  | { status: 'COMMITTED'; settlement: SettleRoundResult }
  | { status: 'ALREADY_SETTLED'; householdState: HouseholdState }
```

- [ ] `commitRoundSettlement` returns `ALREADY_SETTLED` when current round differs from expected.
- [ ] `processRound` calls `publishRealtimeState` only for `COMMITTED`.
- [ ] `ROUND_SETTLED.payload.forcedSettlement = decision === null && input.forceSettle === true`.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/processRound.test.ts src/homeEconomics/onCall.test.ts`; verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics functions/src/lessonRuns/households && git commit -m "feat: harden household settlement primitives"`

---

## Task 2: Bulk operation repository and lease

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/bulkSettlementOperation.ts`
- Create: `functions/src/homeEconomics/bulkSettlementOperation.test.ts`

**Consumes:** `idempotencyDocumentId`, `requestDigest`, Firestore Admin SDK.

**Produces:** server-only `householdBulkSettlementOperations/{operationId}` repository and lease API.

### 2.1 Model + create/replay

- [ ] Add failing tests for deterministic ID, same-key replay, digest mismatch, different-key unresolved-operation blocking.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlementOperation.test.ts`; verify failure.
- [ ] Implement:

```ts
export const HOUSEHOLD_BULK_LEASE_MS = 60_000

export interface HouseholdBulkSettlementOperation {
  operationId: string
  lessonRunId: string
  expectedRoundIndex: number
  restoreGeneration: number
  forceUnsubmitted: boolean
  actorUid: string
  status: HouseholdBulkOperationStatus
  preSettlementCheckpointId: string | null
  requestDigest: string
  attempt: number
  leaseExpiresAtServerMillis: number | null
  lastHeartbeatAtServerMillis: number | null
  households: Record<string, {
    status: HouseholdBulkItemStatus
    errorCode?: string
    errorMessage?: string
  }>
  createdAtServerMillis: number
  updatedAtServerMillis: number
}
```

- [ ] `operationId = idempotencyDocumentId(lessonRunId, idempotencyKey)`.
- [ ] Team IDs passed from server are sorted and become initial PENDING item map.
- [ ] Expired RUNNING operation with another key remains unresolved; do not silently start a new operation.

### 2.2 Lease + item persistence

- [ ] Add failing tests for lease acquire, unexpired contention, same-operation expired reacquire, heartbeat, item success preservation, final FAILED/COMPLETED.
- [ ] Lease acquire is transactional and increments `attempt`.
- [ ] Heartbeat extends to `now + HOUSEHOLD_BULK_LEASE_MS` after every item.
- [ ] Export separate helpers for:
  - unresolved operation lookup used to block a new bulk request;
  - unexpired active lease lookup used by individual settlement/checkpoint/restore.
- [ ] Retry never resets SUCCEEDED items.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlementOperation.test.ts`; verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics/bulkSettlementOperation* && git commit -m "feat: add household bulk operation lease"`

---

## Task 3: Checkpoint v2 core

**Owner:** Claude

**Files:**
- Create: `functions/src/homeEconomics/householdCheckpoint.ts`
- Create: `functions/src/homeEconomics/householdCheckpoint.test.ts`
- Modify: `functions/src/homeEconomics/checkpointRestore.ts`
- Modify: `functions/src/homeEconomics/checkpointRestore.test.ts`

**Consumes:** Tasks 1–2, `writeCheckpointWithAdminSdk`, RTDB safe team projection, event counter.

**Produces:** v2 codec, manifest, server-derived manual/internal writer. No Callable wiring in this task.

### 3.1 v2 codec + v1 compatibility

- [ ] Add failing tests for v2 construction/type guard, malformed v2, existing v1 decode, v1 exclusion from manifests.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdCheckpoint.test.ts src/homeEconomics/checkpointRestore.test.ts`; verify failure.
- [ ] Implement `HouseholdCheckpointSnapshotV2` exactly as Canonical Contracts.
- [ ] Preserve existing v1 decoder. New manifest function returns only v2 + ALL_HOUSEHOLDS.

### 3.2 Complete all-household snapshot

- [ ] Add failing tests proving internal writer receives server-derived team IDs and never accepts teamViews from a public request.
- [ ] For each team: ensure missing HouseholdState using Task 1.
- [ ] Read `lessonRunTeamState/{lessonRunId}/{teamId}/household` using Admin RTDB.
- [ ] If team projection is absent at round 0, build the exact allow-listed initial `HouseholdStateTeamView` with existing projection helpers, no occurred events and no shortfall options.
- [ ] If projection is absent after round 0, fail; do not synthesize historical disclosure state.
- [ ] Never capture `lessonRunPrivate`.

### 3.3 Server-derived phase/sequence and write API

- [ ] Add failing tests for event-counter present/absent and null currentPhaseId.
- [ ] Internal write signature:

```ts
export interface WriteHouseholdCheckpointV2Input {
  lessonRunId: string
  householdIds: string[]
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  expectedRoundIndex: number | null
  actorUid: string
  idempotencyKey: string
}
```

- [ ] Use `LessonRun.currentPhaseId ?? '__NO_PHASE__'`.
- [ ] Use `lessonRuns/{lessonRunId}/meta/eventCounter.value` as current sequence; when absent use `-1`. This server-only v2 path may persist `sequence=-1` before the first event.
- [ ] `createdAtServerMillis` is server time; `createdByUid = actorUid`.
- [ ] Manual service takes `{ lessonRunId, label, actorUid, idempotencyKey }`, enumerates authoritative team IDs, rejects unexpired bulk lease, then invokes the internal writer.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdCheckpoint.test.ts src/homeEconomics/checkpointRestore.test.ts`; verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics/householdCheckpoint* functions/src/homeEconomics/checkpointRestore* && git commit -m "feat: add household checkpoint v2"`

---

## Task 4: Teacher dashboard server core

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/teacherDashboard.ts`
- Create: `functions/src/homeEconomics/teacherDashboard.test.ts`

**Consumes:** Task 1 preview helper, Task 2 operation repository, Task 3 manifests, decisions, teams, `ROUND_SETTLED` events.

**Produces:** authorized-callable-ready dashboard loader/builders. Do not edit `onCall.ts` or `functions/src/index.ts` in this task.

### 4.1 Pure projection

- [ ] Add failing tests for aligned rounds, mismatched rounds, unsubmitted row, shortfall warning, goal delay, failed bulk item, restore info, hidden event suppression.
- [ ] Assert serialized result lacks `randomSeed`, `internalRiskFactors`, `internalClaimProbability`, private coefficients and unrevealed event IDs.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/teacherDashboard.test.ts`; verify failure.
- [ ] `currentRoundIndex` is shared round only when all rows align, else null.
- [ ] `totalAssetsYen` sums only asset holdings; do not include cash/insurance.
- [ ] Warning generation is deterministic and operational only.

### 4.2 Server loader

- [ ] Enumerate `lessonRuns/{lessonRunId}/teams`; document ID is canonical teamId.
- [ ] Optional team label normalization:

```ts
export const normalizeTeamDisplayName = (teamId: string, data: Record<string, unknown>): string => {
  const value = data.displayName
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : teamId
}
```

- [ ] Missing HouseholdState is represented with Task 1 in-memory preview; dashboard read must not create it.
- [ ] For each row, query latest decision for that row's own roundIndex.
- [ ] Build latest settlement summary from `ROUND_SETTLED` event payload, not private RTDB.
- [ ] `revealedEvents` comes only from already-safe disclosure data/projection helpers.
- [ ] List Task 3 v2 manifests only.
- [ ] Return latest relevant PENDING/RUNNING/FAILED operation safe view. Failed item generates ACTION_REQUIRED warning.
- [ ] Loader accepts already-authorized LessonRun/home-economics context or is documented as server-internal; it must not be called before Task 7 authorization.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/teacherDashboard.test.ts`; verify pass.
- [ ] Commit: `git add functions/src/homeEconomics/teacherDashboard* && git commit -m "feat: build household teacher dashboard projection"`

---

## Task 5: Bulk settlement server core

**Owner:** Claude

**Files:**
- Create: `functions/src/homeEconomics/bulkSettlement.ts`
- Create: `functions/src/homeEconomics/bulkSettlement.test.ts`

**Consumes:** Tasks 1–3, `processRoundWithAdminSdk`, household decision repository.

**Produces:** create/replay and retry services. Do not edit `onCall.ts` or `functions/src/index.ts` in this task.

### 5.1 Preflight

- [ ] Add failing tests for non-RUNNING, wrong subject/format, round mismatch, household misalignment, unresolved prior operation, normal missing submissions.
- [ ] Verify normal missing-submission path does not checkpoint or call processRound.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlement.test.ts`; verify failure.
- [ ] Server enumerates/sorts team IDs; creates/replays Task 2 operation; acquires lease; initializes missing households; then re-reads household states and decisions.
- [ ] If any household round differs from expected, finalize failure.
- [ ] Normal mode with any missing decision finalizes FAILED before checkpoint/settlement mutation.

### 5.2 PRE_SETTLEMENT checkpoint

- [ ] Add failing replay test proving only one checkpoint.
- [ ] Key: `pre-settlement:${operationId}`.
- [ ] Kind `PRE_SETTLEMENT`; label `第${expectedRoundIndex + 1}ラウンド 決算前`.
- [ ] Save checkpointId to operation record before first item.

### 5.3 Crash-safe item processing

- [ ] Add failing tests for all success, one thrown item, crash after household commit before item status persistence, retry, changed restoreGeneration, changed round, lease reacquire.
- [ ] For each non-SUCCEEDED item:
  1. heartbeat;
  2. re-read current HouseholdState;
  3. if round is `expectedRoundIndex + 1`, treat as already committed and mark SUCCEEDED;
  4. if round is neither expected nor expected+1, mark incompatible failure;
  5. resolve current-round decision;
  6. call `processRoundWithAdminSdk` with `forceSettle = operation.forceUnsubmitted && decision === null`;
  7. COMMITTED is success; ALREADY_SETTLED is success only when authoritative state is expected+1;
  8. persist item result before next team.
- [ ] Retry processes only PENDING/FAILED items and never resets SUCCEEDED.
- [ ] Before retry, current `restoreGeneration` must equal operation value.
- [ ] Complete iff all items SUCCEEDED; otherwise FAILED.

### 5.4 Dedicated retry service

- [ ] Add tests proving retry uses `{ lessonRunId, operationId }`, not a new create idempotency key.
- [ ] `retryHouseholdRoundBatchWithAdminSdk({ lessonRunId, operationId, actorUid })` loads the existing operation and requires `operation.lessonRunId === lessonRunId` and `operation.actorUid === actorUid`.
- [ ] COMPLETED returns its safe view without work.
- [ ] Unexpired RUNNING returns failed-precondition; expired RUNNING/PENDING/FAILED may reacquire lease and resume.
- [ ] Return only `HouseholdBulkSettlementOperationView`.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlement.test.ts src/homeEconomics/bulkSettlementOperation.test.ts src/homeEconomics/processRound.test.ts`; verify pass.
- [ ] Commit: `git add functions/src/homeEconomics/bulkSettlement* && git commit -m "feat: orchestrate household round settlement"`

---

## Task 6: Atomic household restore server core

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/householdRestore.ts`
- Create: `functions/src/homeEconomics/householdRestore.test.ts`

**Consumes:** Task 2 lease lookup, Task 3 v2 writer/type guard, `appendLessonEventInTransaction`.

**Produces:** atomic v2 restore service + retryable RTDB projection sync. Do not edit `onCall.ts` or `functions/src/index.ts` in this task.

### 6.1 Dedicated restore idempotency

- [ ] Add failing same-key replay/digest mismatch tests.
- [ ] Use:

```ts
export interface HouseholdRestoreIdempotencyRecord {
  checkpointId: string
  requestDigest: string
  newRestoreGeneration: number
  eventId: string
  preRestoreCheckpointId: string
  projectionStatus: 'PENDING' | 'SYNCED'
}
```

Path:

```text
lessonRuns/{lessonRunId}/householdCheckpointRestoreIdempotency/{idempotencyDocumentId(lessonRunId, idempotencyKey)}
```

### 6.2 Safe candidate + PRE_RESTORE

- [ ] Add failing tests for v1, wrong scope, current household ID mismatch, active bulk lease.
- [ ] Accept only v2 ALL_HOUSEHOLDS.
- [ ] Compare sorted authoritative current team/household IDs exactly to snapshot IDs.
- [ ] Key: `pre-restore:${idempotencyDocumentId(lessonRunId, idempotencyKey)}`; create once with kind PRE_RESTORE before restore transaction.

### 6.3 One Firestore transaction

- [ ] Add injected-failure test proving no partial HouseholdState restore.
- [ ] Read first: dedicated idempotency record, LessonRun, checkpoint, all current HouseholdState docs, then event idempotency/counter through `appendLessonEventInTransaction`.
- [ ] Validate checkpoint again in transaction.
- [ ] Increment `restoreGeneration` once.
- [ ] Write all snapshot HouseholdState docs.
- [ ] Append `CHECKPOINT_RESTORED` with `{ checkpointId, reason, newRestoreGeneration }`.
- [ ] Write restore record with projectionStatus PENDING.
- [ ] Do not call generic restore first and perform a second household write transaction.

### 6.4 RTDB projection sync

- [ ] Add failing tests for RTDB failure after Firestore commit, projection-only retry, retry after newer generation.
- [ ] One RTDB root `update()` restores every `lessonRunTeamState/{run}/{team}/household`, updates team-node orgId/updatedAtMillis, and sets each stale `lessonRunPrivate/{run}/householdComputationLog/{householdId}` to null.
- [ ] Do not alter `lessonRunPublic.economicFactors`.
- [ ] Mark projectionStatus SYNCED only after RTDB update succeeds.
- [ ] PENDING retry is allowed only when current restoreGeneration equals record.newRestoreGeneration. Newer generation => failed-precondition and no stale RTDB write.
- [ ] Decision history is untouched.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdRestore.test.ts src/homeEconomics/householdCheckpoint.test.ts`; verify pass.
- [ ] Commit: `git add functions/src/homeEconomics/householdRestore* && git commit -m "feat: make household restore atomic"`

---

## Task 7: Wire server Callables and add client wrappers

**Owner:** Claude

**Files:**
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Create: `src/lib/homeEconomics/teacherDashboard.ts`
- Create: `src/lib/homeEconomics/teacherDashboard.test.ts`
- Create: `src/lib/homeEconomics/bulkSettlement.ts`
- Create: `src/lib/homeEconomics/bulkSettlement.test.ts`
- Create: `src/lib/homeEconomics/checkpoints.ts`
- Create: `src/lib/homeEconomics/checkpoints.test.ts`
- Modify: `src/lib/homeEconomics/processRound.ts`
- Modify: `src/lib/homeEconomics/processRound.test.ts`

**Consumes:** Tasks 4–6 server cores.

**Produces:** authorized public API surface and thin client wrappers.

### 7.1 Dashboard Callable auth ordering

- [ ] Add failing onCall tests proving unauthenticated request has zero reads; invalid scalar stops before run; unknown teacher/inactive member cannot reach subordinate reads; VIEWER can read; unsupported subject/format fails before subordinate reads.
- [ ] Implement `getHouseholdTeacherDashboardCallable({ lessonRunId })` with Global Constraint 2 ordering, then invoke Task 4 core.

### 7.2 Bulk create/retry + individual lease guard

- [ ] Add failing tests for PRIMARY-only create/retry, active membership, RUNNING, subject/format, operation actor match on retry.
- [ ] Export callables:

```ts
processHouseholdRoundBatchCallable
retryHouseholdRoundBatchCallable
```

Requests are the two Canonical Contracts.
- [ ] Add active lease check to existing client-facing `processRoundCallable` after role/member/status authorization and before settlement. Bulk core calls internal `processRoundWithAdminSdk`, so it does not self-block.

### 7.3 Manual checkpoint + restore Callables

- [ ] Replace public manual checkpoint request with `{ lessonRunId, label, idempotencyKey }`; validate trimmed label 1–80.
- [ ] PRIMARY/ASSISTANT only; active membership before Task 3 subordinate service.
- [ ] Existing `restoreHouseholdCheckpointCallable` request stays `{ lessonRunId, checkpointId, reason, idempotencyKey }`; trimmed reason required; PRIMARY/ASSISTANT only; invoke Task 6 service instead of old two-step restore.
- [ ] Export new dashboard/bulk/retry callables from `functions/src/index.ts`; preserve existing callable names for write/restore.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/onCall.test.ts` and `npm --prefix functions run typecheck`; verify pass.

### 7.4 Client wrappers

- [ ] Add failing wrapper tests for callable names/payloads.
- [ ] `teacherDashboard.ts`: synchronized dashboard interfaces + `getHouseholdTeacherDashboard(functions, lessonRunId)`.
- [ ] `bulkSettlement.ts`: `processHouseholdRoundBatch(functions,input)` and `retryHouseholdRoundBatch(functions,{lessonRunId,operationId})`.
- [ ] `checkpoints.ts`: manual save + restore wrappers.
- [ ] Update `processRound.ts` client type to Task 1 `ProcessRoundExecutionResult`; callers cannot assume settlement detail always exists.
- [ ] Wrapper modules contain no authorization, warning inference, household enumeration or hidden-event filtering.
- [ ] Run:

```bash
npm test -- src/lib/homeEconomics/teacherDashboard.test.ts src/lib/homeEconomics/bulkSettlement.test.ts src/lib/homeEconomics/checkpoints.test.ts src/lib/homeEconomics/processRound.test.ts
npm run typecheck
```

- [ ] Commit: `git add functions/src/homeEconomics/onCall* functions/src/index.ts src/lib/homeEconomics && git commit -m "feat: expose household teacher operations"`

---

## Task 8: Build HouseholdTeacherDashboard React UI

**Owner:** Codex

**Files:**
- Create: `src/components/teacher/HouseholdTeacherDashboard.tsx`
- Create: `src/components/teacher/HouseholdTeacherDashboard.test.tsx`

**Consumes:** Task 7 wrappers, `LessonRunRole`.

**Produces:** summary/actions/table/checkpoint history UI.

### 8.1 Read-only surface

- [ ] Add failing tests for loading, error, aligned summary, mismatched rounds, warning badges, row expansion, VIEWER read-only.
- [ ] Run `npm test -- src/components/teacher/HouseholdTeacherDashboard.test.tsx`; verify failure.
- [ ] Props:

```ts
export interface HouseholdTeacherDashboardProps {
  lessonRunId: string
  role: LessonRunRole
  functions: Functions
}
```

- [ ] Load on mount; add 「最新状態に更新」.
- [ ] Summary: round, submitted/all, settled progress, action-required count, last updated. Mismatch shows 「家庭ごとに進行位置が異なります」 instead of one round.
- [ ] Compact row columns: チーム / ラウンド / 提出 / 決算 / 現金 / 資産 / 借入 / 警告.
- [ ] Expansion: life stage, asset composition, insurance, liabilities, latest income/expense/net/shortfall, goal delay, revealed events.

### 8.2 Settlement controls

- [ ] Add failing role/state tests.
- [ ] PRIMARY only: individual normal settlement; normal bulk; explicit force bulk.
- [ ] Normal bulk enabled only aligned + all current-round decisions submitted.
- [ ] Force confirmation lists missing teams and calls create with `forceUnsubmitted=true`; it is never an implicit fallback from normal action.
- [ ] While a mutation is pending, disable duplicate relevant clicks.
- [ ] If active operation is PENDING/RUNNING, disable individual settlement/manual checkpoint/restore and display operation status.
- [ ] FAILED operation shows per-item failures and 「失敗した家庭を再試行」; call Task 7 retry wrapper using `{ lessonRunId, operationId }`. Never mint a new create idempotency key for retry.
- [ ] Individual settle never exposes `forceSettle`; it can be used only for a submitted household and only when no active bulk lease is reported.
- [ ] Reload dashboard after success/retry.

### 8.3 Checkpoint controls

- [ ] Add failing tests for PRIMARY/ASSISTANT manual save, label 1–80, history, restore reason/confirmation, VIEWER hidden actions.
- [ ] Manual save dialog creates one UUID on confirm and sends it once.
- [ ] Restore dialog names target checkpoint and states current state will be saved first; require non-empty reason and one UUID on confirm.
- [ ] Reload after save/restore.
- [ ] Run `npm test -- src/components/teacher/HouseholdTeacherDashboard.test.tsx`; verify pass.
- [ ] Run `npm run typecheck`.
- [ ] Commit: `git add src/components/teacher/HouseholdTeacherDashboard* && git commit -m "feat: add household teacher dashboard ui"`

---

## Task 9: Integrate into App and LessonControlRoom

**Owner:** Claude

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Consumes:** Task 8 component; existing LessonRun top-level `subject`, `templateSnapshot.homeEconomics.courseFormat`.

**Produces:** one control route with subject/course-format gating.

### 9.1 Reuse route guard LessonRun read

- [ ] Add failing App tests for subject/course-format extraction from the existing `getDoc(lessonRuns/{runId})` read.
- [ ] Extend local access state:

```ts
interface TeacherAccess {
  status: AccessStatus
  role?: LessonRunRole
  subject?: LessonSubject
  homeEconomicsCourseFormat?: string
}
```

- [ ] Read top-level `subject` and `templateSnapshot.homeEconomics.courseFormat` from the same snapshot used to resolve `teacherRoles`; no second route read.
- [ ] Pass values to `LessonControlRoom`.

### 9.2 Gate household UI

- [ ] Add failing `LessonControlRoom` tests:
  - SOCIAL_STUDIES: existing controls only, no household dashboard;
  - HOME_ECONOMICS + COMMON_CONDITIONS: household dashboard rendered;
  - HOME_ECONOMICS + other format: unsupported notice, no dashboard;
  - existing participant/phase/intervention/safe-stop controls remain.
- [ ] Extend props with `subject: LessonSubject` and optional `homeEconomicsCourseFormat`.
- [ ] Render dashboard only for exact supported pair.
- [ ] Route remains `/teacher/lessons/:runId/control`.
- [ ] Run:

```bash
npm test -- src/App.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
npm run typecheck
```

- [ ] Commit: `git add src/App.tsx src/App.test.tsx src/components/teacher && git commit -m "feat: integrate household dashboard into control room"`

---

## Task 10: Rules, acceptance coverage, backlog update, full verification

**Owner:** Codex

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`
- Modify: `test/household-lifecycle.acceptance.test.ts`
- Modify: `docs/superpowers/scope-backlog.md`

**Consumes:** Tasks 1–9.

**Produces:** explicit server-only Rules, regression coverage, updated Phase 4 ledger, verified/pushed branch.

### 10.1 Explicit server-only Rules

- [ ] Add failing Emulator tests proving signed-in teachers cannot directly read/write:
  - `householdBulkSettlementOperations/{operationId}`;
  - `lessonRuns/{lessonRunId}/householdCheckpointRestoreIdempotency/{key}`.
- [ ] Run `npm run test:rules`; verify new assertions fail before rule entries.
- [ ] Add explicit deny entries:

```text
match /householdBulkSettlementOperations/{operationId} {
  allow read, write: if false;
}
```

Inside `lessonRuns/{lessonRunId}`:

```text
match /householdCheckpointRestoreIdempotency/{key} {
  allow read, write: if false;
}
```

- [ ] Re-run `npm run test:rules`; verify pass.

### 10.2 Household lifecycle acceptance

- [ ] Extend `test/household-lifecycle.acceptance.test.ts` to cover:
  1. dashboard lists uninitialized COMMON_CONDITIONS teams without mutating state;
  2. normal bulk rejects missing submissions;
  3. force bulk creates one PRE_SETTLEMENT checkpoint and settles all;
  4. retry after crash does not double-settle;
  5. manual v2 checkpoint appears in manifest;
  6. restore creates one PRE_RESTORE checkpoint and restores every HouseholdState atomically;
  7. safe team views are restored;
  8. stale private computation logs are removed;
  9. decision history remains.
- [ ] Run `npm test -- test/household-lifecycle.acceptance.test.ts`; verify pass.

### 10.3 Scope ledger

- [ ] Freshly re-read `docs/superpowers/scope-backlog.md` immediately before editing.
- [ ] Mark the COMMON_CONDITIONS teacher operation dashboard implemented: overview, individual/bulk/explicit-force settlement, checkpoint v2, atomic restore, Control Room integration.
- [ ] Keep advanced formats as remaining work.
- [ ] Do not mark unrelated visualization/evaluation work complete unless implementation actually covers it.

### 10.4 Full verification and push

- [ ] Run:

```bash
npm --prefix functions run verify
npm run verify
```

- [ ] Fix implementation/test failures; do not weaken assertions merely to turn the suite green.
- [ ] Commit final Rules/acceptance/backlog changes:

```bash
git add firestore.rules test/firestore.rules.test.ts test/household-lifecycle.acceptance.test.ts docs/superpowers/scope-backlog.md
git commit -m "test: verify household teacher dashboard workflow"
```

- [ ] Re-run both verification commands after final commit.
- [ ] Confirm clean intended state with `git status --short` and `git log -1 --oneline`.
- [ ] Push `git push origin codex/classroom`.
- [ ] Verify remote `codex/classroom` HEAD equals local final commit before completion report.

---

## Final Review Checklist

- [ ] Actual GitHub diff matches this scope; no advanced course-format implementation slipped in.
- [ ] Auth ordering is correct for every new/modified teacher Callable.
- [ ] Dashboard response contains no private seed/risk/claim/coefficient/future-event data.
- [ ] SOCIAL_STUDIES never mounts/calls household dashboard.
- [ ] Normal bulk with missing submissions makes no household/checkpoint mutation.
- [ ] Force is explicit and audit event marks only actually forced households.
- [ ] Same create key/same payload replays; same key/different payload rejects.
- [ ] Retry is by operationId, resumes the same operation, and never reprocesses SUCCEEDED items.
- [ ] Crash after household commit but before item-status write is reconciled by authoritative roundIndex.
- [ ] Duplicate individual settlement does not stale-publish RTDB.
- [ ] Active bulk lease blocks individual/manual checkpoint/restore Callables.
- [ ] v2 snapshot contains all current household IDs + safe team views and no private log.
- [ ] v1 is not offered by new restore UI.
- [ ] PRE_SETTLEMENT/PRE_RESTORE do not multiply on retry.
- [ ] Restore changes all HouseholdState docs in one Firestore transaction and increments restoreGeneration once.
- [ ] Projection retry cannot overwrite a newer restore generation.
- [ ] Restore clears stale private household computation logs but leaves public economic factors unchanged.
- [ ] Direct client access to operation/restore-idempotency records is denied.
- [ ] `npm --prefix functions run verify` passes.
- [ ] `npm run verify` passes.
- [ ] Remote `codex/classroom` contains the final implementation commit.
