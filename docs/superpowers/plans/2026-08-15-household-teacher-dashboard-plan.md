# 家庭科・教師用授業運用ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` task-by-task. Before any completion claim, use `superpowers:verification-before-completion`.

**Goal:** `HOME_ECONOMICS` / `COMMON_CONDITIONS` の授業で、教師が既存 `/teacher/lessons/:runId/control` から全家庭の状況確認、個別/一括/明示的強制決算、手動/自動チェックポイント、全家庭復元を安全に行えるようにする。

**Architecture:** Firestore の `HouseholdState`・意思決定・`ROUND_SETTLED` event を正本にする。教師画面は server-authoritative dashboard Callable から allow-list 済み運用ビューだけを取得し、`lessonRunPrivate` を通常UIの読取元にしない。一括決算は server-only operation record + lease + per-household status で管理する。Checkpoint v2 は既存 `lessonRuns/{run}/checkpoints` collection を使いながら、v2専用 idempotency mapping を同一 Firestore transaction で保存して retry 時の checkpoint 増殖を防ぐ。Restore は全 `HouseholdState` を1 Firestore transactionで戻し、その後 RTDB safe projection を再試行可能に同期する。

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
8. Bulk operation は lease を持ち、SUCCEEDED item を retry で再処理しない。
9. 通常一括決算は未提出が1件でもあれば household/checkpoint mutation 前に止める。operation metadata の失敗記録は許容する。
10. 強制決算は別の明示操作。未提出家庭だけ forced とし、`ROUND_SETTLED.payload.forcedSettlement` に監査情報を残す。
11. Duplicate settlement の CAS が no-op なら stale result を RTDB publish しない。
12. 新UIで復元できるのは checkpoint v2 + `scope='ALL_HOUSEHOLDS'` のみ。v1 はデコード互換だけ残す。
13. Checkpoint v2 の idempotency は `sequence` に依存させない。同一 request retry は最初に保存した checkpointId を返す。
14. Restore 前に PRE_RESTORE checkpoint を同一 restore request につき1回だけ作る。
15. Restore は decision history を消さない。
16. RTDB restore sync は retryable。Firestore restore commit を二重実行せず projection のみ再試行できるようにする。
17. SOCIAL_STUDIES では Household dashboard Callable を呼ばない。
18. `HouseholdRoundControlPanel` など無関係な既存コードはこの計画では削除しない。
19. 各実装タスクは fail test → failure確認 → minimal implementation → pass確認 → commit の順で進める。最終 Rules/acceptance タスクでは、既存 catch-all denial のように「既に満たされている不変条件」は regression test で確認し、挙動を変えるためだけの不要な rule edit をしない。

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
  leaseActive: boolean
  retryable: boolean
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
- **Task 10 — Codex:** Rules regression, acceptance, backlog, full verification

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

- [ ] Add failing repository test for current initial state values.
- [ ] Run `npm --prefix functions test -- src/lessonRuns/households/repository.test.ts`; verify failure.
- [ ] Add this helper and make `getOrInitHouseholdState` use it:

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

### 1.2 Centralize COMMON_CONDITIONS resolution

- [ ] Add failing tests for COMMON_CONDITIONS+1 profile success, other format rejection, profile-count mismatch, preview no-write, ensure idempotency.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/commonConditionsHousehold.test.ts`; verify failure.
- [ ] Implement `previewCommonConditionsHouseholdState(...)` using `profile.cashSavingsYen`, `profile.lifeStage`, `householdId === teamId`.
- [ ] Implement `ensureCommonConditionsHouseholdStateWithAdminSdk(lessonRunId, teamId)` via `getOrInitHouseholdState`.
- [ ] Student submit path keeps `requireTeamMembership` before shared ensure helper.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/commonConditionsHousehold.test.ts src/homeEconomics/onCall.test.ts`; verify pass.

### 1.3 Make duplicate settlement explicit

- [ ] Add failing tests proving CAS miss returns authoritative current state and does not publish RTDB.
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

- [ ] `commitRoundSettlement` returns ALREADY_SETTLED when current round differs from expected.
- [ ] `processRound` publishes RTDB only for COMMITTED.
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
- [ ] Implement `HOUSEHOLD_BULK_LEASE_MS = 60_000` and the operation model from Canonical Contracts plus internal actor/requestDigest/attempt/lease timestamps.
- [ ] `operationId = idempotencyDocumentId(lessonRunId, idempotencyKey)`.
- [ ] Team IDs are sorted before creating PENDING item map.
- [ ] Expired RUNNING operation with another key remains unresolved; do not silently start a second operation.

### 2.2 Lease + item persistence

- [ ] Add failing tests for acquire, unexpired contention, same-operation expired reacquire, heartbeat, item success preservation, final FAILED/COMPLETED.
- [ ] Lease acquire is transactional and increments attempt.
- [ ] Heartbeat extends to `now + HOUSEHOLD_BULK_LEASE_MS` after every item.
- [ ] Export separate unresolved-operation and unexpired-active-lease lookups.
- [ ] Safe view computes `leaseActive = status === 'RUNNING' && leaseExpiresAtServerMillis > now`.
- [ ] Safe view computes `retryable = status !== 'COMPLETED' && !leaseActive`.
- [ ] Retry never resets SUCCEEDED items.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlementOperation.test.ts`; verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics/bulkSettlementOperation* && git commit -m "feat: add household bulk operation lease"`

---

## Task 3: Checkpoint v2 core with sequence-independent idempotency

**Owner:** Claude

**Files:**
- Create: `functions/src/homeEconomics/householdCheckpoint.ts`
- Create: `functions/src/homeEconomics/householdCheckpoint.test.ts`

**Consumes:** Tasks 1–2, current checkpoints collection schema, RTDB safe team projection, event counter.

**Produces:** v2 codec, manifest, server-derived writer with v2-specific idempotency. No Callable wiring in this task.

### 3.1 v2 codec + v1 exclusion

- [ ] Add failing tests for v2 construction/type guard, malformed v2, existing v1 not matching v2, v1 excluded from manifests.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdCheckpoint.test.ts`; verify failure.
- [ ] Implement `HouseholdCheckpointSnapshotV2` exactly as Canonical Contracts.
- [ ] Do not remove/change `functions/src/homeEconomics/checkpointRestore.ts` v1 codec. Manifest helper returns only v2 + ALL_HOUSEHOLDS.

### 3.2 Complete all-household snapshot

- [ ] Add failing tests proving public/manual input cannot inject household IDs or teamViews.
- [ ] For each authoritative team, ensure missing HouseholdState using Task 1.
- [ ] Read `lessonRunTeamState/{run}/{team}/household` via Admin RTDB.
- [ ] If team projection is absent at round 0, build exact allow-listed initial `HouseholdStateTeamView` using existing projection helpers, no occurred events and no shortfall options.
- [ ] If projection is absent after round 0, fail; do not synthesize historical disclosures.
- [ ] Never capture `lessonRunPrivate`.

### 3.3 Dedicated v2 idempotency mapping

The generic Phase A checkpoint ID includes `sequence`, so it cannot guarantee one PRE_SETTLEMENT/PRE_RESTORE checkpoint after event sequence changes. Reuse the same `checkpoints` collection but persist v2 idempotency directly.

- [ ] Add failing test: create checkpoint, advance event sequence/change current household state, replay same key+same intent, and verify original checkpointId/snapshot is returned with no second checkpoint.
- [ ] Add failing same-key/different-intent test.
- [ ] Use mapping path:

```text
lessonRuns/{lessonRunId}/householdCheckpointV2Idempotency/{idempotencyDocumentId(lessonRunId, idempotencyKey)}
```

- [ ] Request digest includes stable intent only: `kind`, `label`, `expectedRoundIndex`, `actorUid`. Do not include snapshot state, server timestamp, phaseId or sequence; those are the stored result of the first accepted request.
- [ ] First creation derives current `restoreGeneration`, `currentPhaseId ?? '__NO_PHASE__'`, and event counter value (`-1` when absent), builds the snapshot, then writes checkpoint doc + mapping in one Firestore transaction.
- [ ] Checkpoint ID is sequence-independent:

```ts
const keyId = idempotencyDocumentId(lessonRunId, idempotencyKey)
const checkpointId = `hcp_${restoreGeneration}_${keyId.slice(0, 20)}`
```

- [ ] Mapping stores `{ checkpointId, requestDigest }`. Replay reads mapping first; same digest returns existing checkpointId without rebuilding snapshot.
- [ ] Checkpoint document continues to live at `lessonRuns/{run}/checkpoints/{checkpointId}` and stores `id`, `lessonRunId`, `sequence`, `phaseId`, `snapshot`, `createdBy:'TEACHER'`, `restoreGeneration`, `requestDigest`.

### 3.4 Internal/manual service

- [ ] Internal writer signature:

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

- [ ] Manual service accepts `{ lessonRunId, label, actorUid, idempotencyKey }`, enumerates authoritative team IDs, rejects unexpired bulk lease, and calls internal writer with kind MANUAL.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdCheckpoint.test.ts`; verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics/householdCheckpoint* && git commit -m "feat: add idempotent household checkpoint v2"`

---

## Task 4: Teacher dashboard server core

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/teacherDashboard.ts`
- Create: `functions/src/homeEconomics/teacherDashboard.test.ts`

**Consumes:** Task 1 preview helper, Task 2 operation repository, Task 3 manifests, decisions, teams, `ROUND_SETTLED` events.

**Produces:** authorized-callable-ready dashboard loader/builders. Do not edit `onCall.ts` or `functions/src/index.ts` in this task.

### 4.1 Pure projection

- [ ] Add failing tests for aligned/mismatched rounds, unsubmitted row, shortfall, goal delay, failed bulk item, restore info, hidden-event suppression.
- [ ] Assert serialized result lacks seed/risk/claim/private coefficient/unrevealed event data.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/teacherDashboard.test.ts`; verify failure.
- [ ] `currentRoundIndex` is shared round only when all rows align, else null.
- [ ] `totalAssetsYen` sums asset holdings only.
- [ ] Warning generation is deterministic and operational only.

### 4.2 Server loader

- [ ] Enumerate `lessonRuns/{run}/teams`; doc ID is canonical teamId.
- [ ] Normalize optional label:

```ts
export const normalizeTeamDisplayName = (teamId: string, data: Record<string, unknown>): string => {
  const value = data.displayName
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : teamId
}
```

- [ ] Missing HouseholdState uses Task 1 in-memory preview; dashboard read must not create it.
- [ ] Query latest decision for each row's own roundIndex.
- [ ] Latest settlement summary comes from ROUND_SETTLED event payload, not private RTDB.
- [ ] `revealedEvents` only from safe disclosure data/projection helpers.
- [ ] List Task 3 v2 manifests only.
- [ ] Return latest relevant non-COMPLETED operation safe view including leaseActive/retryable. Failed item adds ACTION_REQUIRED warning.
- [ ] Loader is server-internal and must be called only after Task 7 authorization.
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

- [ ] Add failing tests for non-RUNNING, wrong subject/format, round mismatch, misalignment, unresolved prior operation, normal missing submissions.
- [ ] Verify missing-submission normal path does not checkpoint or call processRound.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlement.test.ts`; verify failure.
- [ ] Enumerate/sort teams; create/replay Task 2 operation; acquire lease; initialize missing households; re-read states/decisions.
- [ ] Any household round mismatch finalizes failure.
- [ ] Normal missing decision finalizes FAILED before checkpoint/settlement mutation.

### 5.2 PRE_SETTLEMENT once

- [ ] Add replay test proving one checkpoint even after event sequence advances.
- [ ] Key `pre-settlement:${operationId}`; kind PRE_SETTLEMENT; label `第${expectedRoundIndex + 1}ラウンド 決算前`.
- [ ] Save returned checkpointId to operation before first item.

### 5.3 Crash-safe items

- [ ] Add failing tests for all success, item throw, crash after household commit before item status write, retry, changed restoreGeneration, changed round, lease reacquire.
- [ ] For each non-SUCCEEDED item: heartbeat → authoritative state read → expected+1 means already committed success → incompatible round means failure → decision read → `processRoundWithAdminSdk(forceSettle = forceUnsubmitted && decision === null)` → persist item result.
- [ ] ALREADY_SETTLED is success only when authoritative state is expected+1.
- [ ] Retry never resets SUCCEEDED and requires matching restoreGeneration.
- [ ] Complete iff all items SUCCEEDED.

### 5.4 Dedicated retry

- [ ] Add tests for `{ lessonRunId, operationId }` retry.
- [ ] `retryHouseholdRoundBatchWithAdminSdk({ lessonRunId, operationId, actorUid })` requires operation.lessonRunId and operation.actorUid match.
- [ ] COMPLETED returns safe view. Unexpired RUNNING rejects. Expired RUNNING/PENDING/FAILED reacquires lease and resumes.
- [ ] Return safe view only.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlement.test.ts src/homeEconomics/bulkSettlementOperation.test.ts src/homeEconomics/processRound.test.ts`; verify pass.
- [ ] Commit: `git add functions/src/homeEconomics/bulkSettlement* && git commit -m "feat: orchestrate household round settlement"`

---

## Task 6: Atomic household restore server core

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/householdRestore.ts`
- Create: `functions/src/homeEconomics/householdRestore.test.ts`

**Consumes:** Task 2 lease lookup, Task 3 v2 writer/type guard, `appendLessonEventInTransaction`.

**Produces:** atomic v2 restore + retryable RTDB sync. Do not edit `onCall.ts` or `functions/src/index.ts` in this task.

### 6.1 Restore idempotency

- [ ] Add failing same-key replay/digest mismatch tests.
- [ ] Record:

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

Path `lessonRuns/{run}/householdCheckpointRestoreIdempotency/{idempotencyDocumentId(run,key)}`.

### 6.2 Candidate + PRE_RESTORE

- [ ] Add failing tests for v1, wrong scope, current household ID mismatch, active bulk lease.
- [ ] Accept only v2 ALL_HOUSEHOLDS and exact sorted current authoritative IDs.
- [ ] Key `pre-restore:${idempotencyDocumentId(lessonRunId,idempotencyKey)}`; create exactly once before restore transaction.

### 6.3 One Firestore transaction

- [ ] Add injected-failure test proving no partial HouseholdState restore.
- [ ] Read dedicated idempotency, LessonRun, target checkpoint, all current HouseholdStates, then event idempotency/counter via `appendLessonEventInTransaction`; no reads after its write scheduling begins.
- [ ] Revalidate snapshot, increment restoreGeneration once, write all snapshot HouseholdStates, append CHECKPOINT_RESTORED, write restore record PENDING.
- [ ] Do not call generic restore first.

### 6.4 RTDB sync

- [ ] Add failing tests for RTDB failure after Firestore commit, projection-only retry, retry after newer generation.
- [ ] One RTDB root update restores every team household view, updates team-node orgId/updatedAtMillis, and clears each stale private `householdComputationLog/{householdId}` with null.
- [ ] Do not alter public economicFactors.
- [ ] Mark SYNCED only after RTDB success.
- [ ] PENDING retry allowed only when current generation equals record.newRestoreGeneration; newer generation rejects with no stale RTDB write.
- [ ] Decision history remains.
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

**Consumes:** Tasks 4–6.

**Produces:** authorized public server API and thin client wrappers.

### 7.1 Dashboard Callable

- [ ] Add failing tests: unauthenticated zero reads; invalid scalar stops before run; unauthorized/inactive cannot reach subordinate reads; VIEWER can read; wrong subject/format stops before subordinate reads.
- [ ] Implement `getHouseholdTeacherDashboardCallable({ lessonRunId })` with Global Constraint 2 order, then Task 4 core.

### 7.2 Bulk create/retry + individual lease guard

- [ ] Add failing tests for PRIMARY-only create/retry, active membership, RUNNING, subject/format, retry actor match.
- [ ] Export `processHouseholdRoundBatchCallable` and `retryHouseholdRoundBatchCallable` using Canonical requests.
- [ ] Existing client-facing `processRoundCallable` checks Task 2 unexpired active lease after role/member/status authorization and before settlement. Bulk core uses internal `processRoundWithAdminSdk` and does not self-block.

### 7.3 Manual checkpoint + restore

- [ ] Public manual request is `{ lessonRunId, label, idempotencyKey }`; trimmed label length 1–80.
- [ ] PRIMARY/ASSISTANT + active membership before Task 3 manual service.
- [ ] Existing restore request stays `{ lessonRunId, checkpointId, reason, idempotencyKey }`; trimmed reason required; PRIMARY/ASSISTANT + active membership before Task 6.
- [ ] Export dashboard/bulk/retry callables from `functions/src/index.ts`; keep existing write/restore callable names.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/onCall.test.ts` and `npm --prefix functions run typecheck`; verify pass.

### 7.4 Client wrappers

- [ ] Add failing tests for callable names/payloads.
- [ ] `teacherDashboard.ts`: synchronized Canonical dashboard types + getter.
- [ ] `bulkSettlement.ts`: create wrapper and retry wrapper using operationId.
- [ ] `checkpoints.ts`: manual save + restore wrappers.
- [ ] `processRound.ts`: mirror Task 1 discriminated execution result; no unconditional settlement detail access.
- [ ] No client wrapper contains authorization, warning inference, household enumeration or hidden-event filtering.
- [ ] Run:

```bash
npm test -- src/lib/homeEconomics/teacherDashboard.test.ts src/lib/homeEconomics/bulkSettlement.test.ts src/lib/homeEconomics/checkpoints.test.ts src/lib/homeEconomics/processRound.test.ts
npm run typecheck
```

- [ ] Commit: `git add functions/src/homeEconomics/onCall* functions/src/index.ts src/lib/homeEconomics && git commit -m "feat: expose household teacher operations"`

---

## Task 8: Build HouseholdTeacherDashboard UI

**Owner:** Codex

**Files:**
- Create: `src/components/teacher/HouseholdTeacherDashboard.tsx`
- Create: `src/components/teacher/HouseholdTeacherDashboard.test.tsx`

**Consumes:** Task 7 wrappers, `LessonRunRole`.

**Produces:** summary/actions/table/checkpoint history UI.

### 8.1 Read-only surface

- [ ] Add failing tests for loading/error/aligned/mismatched/warnings/expansion/VIEWER.
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
- [ ] Summary: round, submitted/all, settlement progress, action-required count, updated time. Mismatch shows 「家庭ごとに進行位置が異なります」.
- [ ] Compact columns: チーム / ラウンド / 提出 / 決算 / 現金 / 資産 / 借入 / 警告.
- [ ] Expansion: life stage, asset composition, insurance, liabilities, last income/expense/net/shortfall, goal delay, revealed events.

### 8.2 Settlement controls

- [ ] Add failing role/state tests.
- [ ] PRIMARY only: individual normal settlement, normal bulk, explicit force bulk.
- [ ] Normal bulk enabled only aligned + all current-round decisions submitted.
- [ ] Force confirmation lists missing teams and sends forceUnsubmitted=true; no implicit fallback.
- [ ] Pending UI mutation disables duplicate clicks.
- [ ] `activeBulkOperation.leaseActive` disables individual/manual checkpoint/restore.
- [ ] `activeBulkOperation.retryable` shows 「失敗した家庭を再試行」 even when stored status is expired RUNNING/PENDING/FAILED; call retry wrapper with `{ lessonRunId, operationId }`.
- [ ] Never mint a new create idempotency key to resume an existing operation.
- [ ] Individual settle never exposes forceSettle and requires submitted row.
- [ ] Reload dashboard after mutation/retry.

### 8.3 Checkpoint controls

- [ ] Add failing tests for PRIMARY/ASSISTANT manual save, 1–80 label, history, restore reason/confirmation, VIEWER no actions.
- [ ] Manual confirm creates one UUID and sends once.
- [ ] Restore dialog names target, states current state is saved first, requires non-empty reason, creates one UUID and sends once.
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

**Consumes:** Task 8; existing LessonRun top-level `subject`, `templateSnapshot.homeEconomics.courseFormat`.

**Produces:** one control route with subject/course-format gating.

### 9.1 Reuse route guard read

- [ ] Add failing App tests for subject/course-format extraction from existing LessonRun getDoc.
- [ ] Extend local access state:

```ts
interface TeacherAccess {
  status: AccessStatus
  role?: LessonRunRole
  subject?: LessonSubject
  homeEconomicsCourseFormat?: string
}
```

- [ ] Read top-level subject and templateSnapshot.homeEconomics.courseFormat from same snapshot used for teacherRoles; no second route read.
- [ ] Pass to LessonControlRoom.

### 9.2 Gate UI

- [ ] Add failing tests: SOCIAL_STUDIES no dashboard; HOME_ECONOMICS+COMMON_CONDITIONS dashboard; other home-economics format unsupported notice; existing control-room features remain.
- [ ] Extend LessonControlRoom props with `subject: LessonSubject` and optional course format.
- [ ] Render dashboard only for exact supported pair.
- [ ] Route path unchanged.
- [ ] Run:

```bash
npm test -- src/App.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
npm run typecheck
```

- [ ] Commit: `git add src/App.tsx src/App.test.tsx src/components/teacher && git commit -m "feat: integrate household dashboard into control room"`

---

## Task 10: Rules regression, acceptance coverage, backlog update, full verification

**Owner:** Codex

**Files:**
- Modify: `test/firestore.rules.test.ts`
- Modify: `test/household-lifecycle.acceptance.test.ts`
- Modify: `docs/superpowers/scope-backlog.md`

**Consumes:** Tasks 1–9.

**Produces:** security regression coverage, end-to-end coverage, updated Phase 4 ledger, verified/pushed branch.

### 10.1 Verify existing catch-all denial for new server-only paths

Current `firestore.rules` catch-all already denies unknown paths, so this is a regression lock rather than a behavior change.

- [ ] Add Emulator tests proving signed-in teachers cannot directly read/write:
  - `householdBulkSettlementOperations/{operationId}`;
  - `lessonRuns/{lessonRunId}/householdCheckpointV2Idempotency/{key}`;
  - `lessonRuns/{lessonRunId}/householdCheckpointRestoreIdempotency/{key}`.
- [ ] Run `npm run test:rules`; expected result is pass under existing catch-all. If it fails, fix the rule without widening any read/write grant.
- [ ] Do not edit `firestore.rules` merely to duplicate an already-effective catch-all deny.

### 10.2 Household lifecycle acceptance

- [ ] Extend `test/household-lifecycle.acceptance.test.ts` to cover:
  1. dashboard lists uninitialized COMMON_CONDITIONS teams without persisting them;
  2. normal bulk rejects missing submissions;
  3. force bulk creates one PRE_SETTLEMENT checkpoint and settles all;
  4. event sequence may advance, but same operation retry still reuses the same v2 checkpoint;
  5. crash retry does not double-settle;
  6. manual v2 checkpoint appears in manifest;
  7. restore creates one PRE_RESTORE checkpoint and restores every HouseholdState atomically;
  8. safe team views restore;
  9. stale private computation logs are removed;
  10. decision history remains.
- [ ] Run `npm test -- test/household-lifecycle.acceptance.test.ts`; verify pass.

### 10.3 Scope ledger

- [ ] Freshly re-read `docs/superpowers/scope-backlog.md` immediately before editing.
- [ ] Mark COMMON_CONDITIONS teacher operation dashboard implemented: overview, individual/bulk/explicit-force settlement, checkpoint v2, atomic restore, Control Room integration.
- [ ] Keep advanced formats as remaining work.
- [ ] Do not mark unrelated visualization/evaluation work complete unless implementation covers it.

### 10.4 Full verification and push

- [ ] Run:

```bash
npm --prefix functions run verify
npm run verify
```

- [ ] Fix implementation/test failures; do not weaken assertions simply to turn the suite green.
- [ ] Commit final regression/backlog changes:

```bash
git add test/firestore.rules.test.ts test/household-lifecycle.acceptance.test.ts docs/superpowers/scope-backlog.md
git commit -m "test: verify household teacher dashboard workflow"
```

- [ ] Re-run both verification commands after final commit.
- [ ] Confirm intended clean state with `git status --short` and `git log -1 --oneline`.
- [ ] Push `git push origin codex/classroom`.
- [ ] Verify remote `codex/classroom` HEAD equals local final commit before completion report.

---

## Final Review Checklist

- [ ] Actual GitHub diff matches scope; no advanced course-format implementation slipped in.
- [ ] Auth ordering is correct for every new/modified teacher Callable.
- [ ] Dashboard response contains no private seed/risk/claim/coefficient/future-event data.
- [ ] SOCIAL_STUDIES never mounts/calls household dashboard.
- [ ] Normal bulk with missing submissions makes no household/checkpoint mutation.
- [ ] Force is explicit and event marks only actually forced households.
- [ ] Same create key/same payload replays; same key/different payload rejects.
- [ ] Existing operation retry is by operationId, not a new create key.
- [ ] Expired lease is visibly retryable; active lease blocks conflicting controls.
- [ ] Retry never reprocesses SUCCEEDED items.
- [ ] Crash after household commit but before item-status write is reconciled by authoritative roundIndex.
- [ ] Duplicate individual settlement does not stale-publish RTDB.
- [ ] Active bulk lease blocks individual/manual checkpoint/restore Callables.
- [ ] v2 snapshot contains all household IDs + safe team views and no private log.
- [ ] v2 checkpoint idempotency is sequence-independent and reuses original checkpoint after event sequence changes.
- [ ] v1 is not offered by new restore UI.
- [ ] PRE_SETTLEMENT/PRE_RESTORE do not multiply on retry.
- [ ] Restore changes all HouseholdStates in one Firestore transaction and increments restoreGeneration once.
- [ ] Projection retry cannot overwrite a newer restore generation.
- [ ] Restore clears stale private household computation logs but leaves public economic factors unchanged.
- [ ] Direct client access to bulk/checkpoint-v2/restore idempotency server paths is denied by Rules tests.
- [ ] `npm --prefix functions run verify` passes.
- [ ] `npm run verify` passes.
- [ ] Remote `codex/classroom` contains the final implementation commit.
