# Household Advanced Course Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** `ROLE_VARIANT`、`STAGE_SPLIT`、`MULTI_PERSON_PER_TEAM` を、Run-scoped assignment、同期一括決算、v3 checkpoint/restore、教師・生徒UI、REFLECTION時の安全なクラス比較まで含めて実装し、既存 `COMMON_CONDITIONS` の外部契約を壊さない。

**Architecture:** 既存の household-centered runtime を維持し、その前段に LessonRun-scoped assignment を置く。教材の `HouseholdProfile.householdId` は論理的 `profileId`、実行単位は opaque な runtime `householdId`、認可単位は `teamId` として分離する。発展3形式は `lessonRuns/{lessonRunId}/householdRuntime/control` の `OPEN | SETTLING` と `synchronizedRoundIndex` でクラス全体を同期し、各 household の settlement は既存 `processRound` を内部 primitive として再利用する。`COMMON_CONDITIONS` は `householdId === teamId`、RTDB `.household`、個別決算、checkpoint v2 を維持する。

**Tech Stack:** Firebase Cloud Functions v2 / Firebase Admin SDK / Firestore / Realtime Database / TypeScript / React 19 / Vite / Vitest / Testing Library / Firebase Rules Unit Testing.

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-15-household-advanced-course-formats-design.md`。実装中に新しい授業仕様を追加しない。
- 各 task 開始前に `docs/superpowers/scope-backlog.md` を読み直す。
- Firestore transaction は **全 read を全 write より先に完了**する。transaction 内で RTDB / 外部I/Oを行わない。
- 教師Callableの認可順は `auth -> LessonRun -> active org membership -> LessonRun role/action -> dependent assignment/profile/state reads -> mutation`。
- 学生Callableは `auth -> participant/auth index -> LessonRun -> requested HouseholdState（未作成なら FROZEN assignment）から server-side teamId を導出 -> team membership確認 -> profile/decision等の依存read -> mutation`。client-supplied `teamId` / `profileId` を認可根拠にしない。
- 発展3形式は通常の個別決算を server-side で拒否する。`processRound` は bulk からだけ内部利用する。
- advanced decision と bulk lock は同じ runtime-control document を transaction 内で読む/更新し、`OPEN -> SETTLING` を競合点にする。
- bulk の partial failure は回復可能状態。barrier は進めず、成功済み item を再settleしない。
- restore は inactive な未完了 bulk を `CANCELLED` に終端化し、`restoreGeneration` を進める。active lease 中は restore を拒否する。
- `COMMON_CONDITIONS` の legacy state/checkpoint に `profileId` が無くても sole-profile fallback で動作させ、一括migrationを前提にしない。
- 学生向け profile / comparison は明示 allow-list のみ。`eventProbabilityOverrides`、`internalRiskFactors`、random seed、claim probability、runtime householdId、生徒氏名/UID/participantId を class-wide projection に出さない。
- 新しい application code の commit は task ごとに分ける。共有ファイルは末尾の serialization order を守る。

---

### Task 1: Advisory validation と assignment pure domain

**Files:**
- Create: `functions/src/homeEconomics/householdAssignment.ts`
- Create: `functions/src/homeEconomics/householdAssignment.test.ts`
- Modify: `functions/src/homeEconomics/templateValidation.ts`
- Modify: `functions/src/homeEconomics/templateValidation.test.ts`

**Interfaces:**

```ts
export type AdvancedHouseholdCourseFormat =
  | 'ROLE_VARIANT'
  | 'STAGE_SPLIT'
  | 'MULTI_PERSON_PER_TEAM'

export interface HouseholdAssignmentEntry {
  householdId: string
  teamId: string
  profileId: string
  slotKey: string
  displayOrder: number
  assignmentSource: 'AUTO' | 'MANUAL'
}

export interface HouseholdAssignmentWarning {
  code: string
  message: string
}

export interface HouseholdAssignmentValidation {
  status: 'READY' | 'INVALID'
  warnings: HouseholdAssignmentWarning[]
}

export const runtimeHouseholdId = (
  lessonRunId: string,
  teamId: string,
  slotKey: string,
): string => idempotencyDocumentId(lessonRunId, `household:${teamId}:${slotKey}`)

export const buildDefaultHouseholdAssignmentEntries = (input: {
  lessonRunId: string
  courseFormat: CourseFormat
  teamIds: string[]
  profiles: HouseholdProfile[]
}): HouseholdAssignmentEntry[]

export const validateHouseholdAssignmentEntries = (input: {
  courseFormat: CourseFormat
  teamIds: string[]
  profiles: HouseholdProfile[]
  entries: HouseholdAssignmentEntry[]
}): HouseholdAssignmentValidation

export const teamSetFingerprint = (teamIds: string[]): string =>
  requestDigest([...teamIds].sort())

export const getHomeEconomicsContentWarnings = (
  content: HomeEconomicsContent,
): string[]
```

- [ ] Add failing tests for deterministic ROLE round-robin and stable opaque runtime IDs.

```ts
expect(buildDefaultHouseholdAssignmentEntries({
  lessonRunId: 'run-1',
  courseFormat: 'ROLE_VARIANT',
  teamIds: ['team-b', 'team-a', 'team-c'],
  profiles: [profileA, profileB],
}).map((entry) => [entry.teamId, entry.profileId])).toEqual([
  ['team-a', 'profile-a'],
  ['team-b', 'profile-b'],
  ['team-c', 'profile-a'],
])
```

- [ ] Add failing STAGE tests: each distinct snapshot `lifeStage` gets one team first; too few teams => `INVALID`; extra teams remain balanced; same-stage profiles rotate deterministically.
- [ ] Add failing MULTI tests: every team gets the complete profile set in snapshot order; same source profile yields different runtime IDs across teams; one-profile run validation is `INVALID`.
- [ ] Add failing advisory-warning tests: ROLE one profile warning only, STAGE one distinct stage warning only, MULTI one profile warning only; current hard validator behavior is unchanged.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- householdAssignment templateValidation
```

- [ ] Implement pure algorithms using sorted `teamId`, snapshot profile order, `idempotencyDocumentId()` and `requestDigest()`; no Firestore reads.
- [ ] Keep warnings separate from `validateHomeEconomicsContent()` so save/publish semantics do not change.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- householdAssignment templateValidation
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdAssignment.ts functions/src/homeEconomics/householdAssignment.test.ts functions/src/homeEconomics/templateValidation.ts functions/src/homeEconomics/templateValidation.test.ts
git commit -m "feat: add household assignment domain"
```

### Task 2: Assignment persistence、PRIMARY callables、client wrapper

**Files:**
- Create: `functions/src/homeEconomics/householdAssignmentRepository.ts`
- Create: `functions/src/homeEconomics/householdAssignmentRepository.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Create: `src/lib/homeEconomics/householdAssignment.ts`
- Create: `src/lib/homeEconomics/householdAssignment.test.ts`

**Interfaces:**

```ts
export interface HouseholdAssignmentConfig {
  courseFormat: CourseFormat
  state: 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number
  teamSetFingerprint: string
  entryIds: string[]
  entriesDigest: string
  lastEditedByUid: string
  lastEditedAtServerMillis: number
  frozenByUid?: string
  frozenAtServerMillis?: number
}

export interface HouseholdAssignmentView {
  lessonRunId: string
  courseFormat: CourseFormat
  state: 'UNPREPARED' | 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number | null
  warnings: HouseholdAssignmentWarning[]
  teams: Array<{
    teamId: string
    teamDisplayName: string
    entries: Array<{
      householdId: string
      profileId: string
      displayOrder: number
      assignmentSource: 'AUTO' | 'MANUAL'
    }>
  }>
}

export interface PrepareHouseholdAssignmentInput {
  lessonRunId: string
  idempotencyKey: string
}

export interface UpdateHouseholdAssignmentInput {
  lessonRunId: string
  expectedRevision: number
  changes: Array<{
    householdId: string
    profileId?: string
    displayOrder?: number
  }>
  idempotencyKey: string
}

export const getHouseholdAssignmentCallable
export const prepareHouseholdAssignmentCallable
export const updateHouseholdAssignmentCallable
```

- [ ] Write repository tests for first prepare, idempotent replay, changed-payload rejection, revision increment, and STALE reconciliation retaining valid MANUAL entries.
- [ ] Add a fake transaction that rejects `get()` after first `set()`/`delete()`; all assignment mutations must pass it.
- [ ] Add tests: FROZEN update rejected; MULTI rejects source-set/profile changes but accepts display-order changes.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- householdAssignmentRepository
```

- [ ] Implement exact server-owned paths:

```text
lessonRuns/{lessonRunId}/householdAssignment/config
lessonRuns/{lessonRunId}/householdAssignment/config/entries/{runtimeHouseholdId}
lessonRuns/{lessonRunId}/householdAssignmentIdempotency/{idempotencyDocumentId}
```

- [ ] Implement `prepare` for the 3 advanced formats only: first generation and STALE reconciliation. Do not create `HouseholdState`. For Common, `get` may return an implicit compatibility view; `prepare/update` must not persist a new Common assignment.
- [ ] Add Callable tests: unauthenticated rejected; ASSISTANT/VIEWER mutation rejected; PRIMARY may prepare/update only advanced HOME_ECONOMICS before FROZEN; all teacher roles with `VIEW_PROGRESS` may read the teacher projection.
- [ ] Export callables from `functions/src/index.ts` and add exact `httpsCallable` client wrappers.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- householdAssignmentRepository onCall
npm test -- src/lib/homeEconomics/householdAssignment.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdAssignmentRepository.ts functions/src/homeEconomics/householdAssignmentRepository.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts functions/src/index.ts src/lib/homeEconomics/householdAssignment.ts src/lib/homeEconomics/householdAssignment.test.ts
git commit -m "feat: add household assignment management"
```

### Task 3: First RUNNING transition と FROZEN を原子的に結合し、advanced late join を既存teamへ入れる

**Files:**
- Create: `functions/src/homeEconomics/statusTransition.ts`
- Create: `functions/src/homeEconomics/statusTransition.test.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.test.ts`
- Modify: `functions/src/lessonRuns/joinLessonRun.ts`
- Modify: `functions/src/lessonRuns/joinLessonRun.test.ts`

**Interfaces:**

```ts
export interface StatusTransitionPreparation {
  writes: Array<{ path: string; data: Record<string, unknown> }>
}

prepareStatusTransition?: (
  tx: FirestoreTx,
  input: {
    lessonRunId: string
    run: Record<string, unknown>
    targetStatus: LessonRunStatus
    actorId: string
    nowValue: unknown
  },
) => Promise<StatusTransitionPreparation | null>

afterStatusTransition?: (input: {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  deduplicated: boolean
}) => Promise<void>

export interface HouseholdRuntimeControl {
  courseFormat: AdvancedHouseholdCourseFormat
  assignmentRevision: number
  synchronizedRoundIndex: number
  roundStatus: 'OPEN' | 'SETTLING'
  activeOperationId: string | null
  updatedAtServerMillis: number
}
```

Persist control at `lessonRuns/{lessonRunId}/householdRuntime/control`.

- [ ] Add transition tests proving preparation reads occur before event/write and returned writes commit atomically with `LessonRun.status`.
- [ ] Add start-validation tests: `meta/teamsIndex` matches config fingerprint; config not STALE/INVALID; entry/profile references valid; STAGE coverage complete; MULTI has >=2 profiles and exact full set per team.
- [ ] Add regression test: **only first lesson start** (`WAITING -> RUNNING` with `startedAt == null`) freezes/initializes control. `PAUSED -> RUNNING` must preserve FROZEN assignment, assignmentRevision, synchronizedRoundIndex, roundStatus, and activeOperationId; it must never reset round to 0.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- statusTransition transitionPhase
```

- [ ] Implement preparation as read-only analysis returning writes. Apply returned writes only after the existing transaction read phase/event reads complete.
- [ ] Keep `afterStatusTransition` post-commit and invoke it even for a deduplicated transition so RTDB repair remains retryable.
- [ ] Add late-join tests: ordinary RUNNING join remains rejected; new RUNNING join is allowed only for advanced HOME_ECONOMICS with FROZEN assignment and at least one existing team.
- [ ] In `joinLessonRun` transaction read `meta/teamsIndex` and existing team docs, use existing `assignBalancedTeam`, write participant as `LATE_JOIN` with selected `teamId`, append member to that team, and never create a new team.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- statusTransition transitionPhase joinLessonRun
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/statusTransition.ts functions/src/homeEconomics/statusTransition.test.ts functions/src/lessonRuns/phases/transitionPhase.ts functions/src/lessonRuns/phases/transitionPhase.test.ts functions/src/lessonRuns/joinLessonRun.ts functions/src/lessonRuns/joinLessonRun.test.ts
git commit -m "feat: freeze household assignments at lesson start"
```

### Task 4: `HouseholdState.profileId`、legacy COMMON normalization、assigned initializer

**Files:**
- Create: `functions/src/homeEconomics/assignedHousehold.ts`
- Create: `functions/src/homeEconomics/assignedHousehold.test.ts`
- Modify: `functions/src/lessonRuns/households/repository.ts`
- Modify: `functions/src/lessonRuns/households/repository.test.ts`
- Modify: `functions/src/homeEconomics/commonConditionsHousehold.ts`
- Modify: `functions/src/homeEconomics/commonConditionsHousehold.test.ts`
- Modify: `functions/src/homeEconomics/processRound.ts`
- Modify: `functions/src/homeEconomics/processRound.test.ts`

**Interfaces:**

```ts
export interface HouseholdState {
  householdId: string
  lessonRunId: string
  teamId: string
  profileId: string
  cashYen: number
  assetHoldingsYen: Record<string, number>
  activeInsuranceContracts: Record<string, number>
  activeLiabilities: Record<string, {
    remainingPrincipalYen: number
    remainingYears: number
    annualInterestRatePercent: number
  }>
  lifeStage: string
  roundIndex: number
  goalDelayedRounds: number
  updatedAtServerMillis: number
}

export type StoredHouseholdState = Omit<HouseholdState, 'profileId'> & { profileId?: string }

export const resolveStoredHouseholdState = (input: {
  stored: StoredHouseholdState
  content: HomeEconomicsContent
}): HouseholdState

export const ensureAssignedHouseholdStateWithAdminSdk = (
  lessonRunId: string,
  householdId: string,
): Promise<HouseholdState>
```

- [ ] Add failing normalization tests: new state has profileId; legacy Common without profileId resolves to sole profile; advanced missing profileId fails closed.
- [ ] Update Common initialization expectations to include profileId while retaining `householdId === teamId`.
- [ ] Add assigned initializer tests: requires FROZEN assignment; uses profileId; idempotent create; existing team/profile mismatch throws.
- [ ] Add processRound test where runtime householdId differs from profileId; add STAGE test proving lifeStage stays fixed after settlement.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- repository commonConditionsHousehold assignedHousehold processRound
```

- [ ] Decode old persistence through `StoredHouseholdState`; do not make business-domain profileId optional globally.
- [ ] Apply sole-profile fallback only to Common. Optional backfill is permitted on the next server write.
- [ ] Resolve processRound profile from normalized `household.profileId`.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- repository commonConditionsHousehold assignedHousehold processRound
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/assignedHousehold.ts functions/src/homeEconomics/assignedHousehold.test.ts functions/src/lessonRuns/households/repository.ts functions/src/lessonRuns/households/repository.test.ts functions/src/homeEconomics/commonConditionsHousehold.ts functions/src/homeEconomics/commonConditionsHousehold.test.ts functions/src/homeEconomics/processRound.ts functions/src/homeEconomics/processRound.test.ts
git commit -m "feat: separate household runtime and profile identity"
```

### Task 5: Advanced decision 認可と `OPEN | SETTLING` transaction guard

**Files:**
- Modify: `functions/src/lessonRuns/households/repository.ts`
- Modify: `functions/src/lessonRuns/households/repository.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/homeEconomics/submitDecision.ts`
- Modify: `functions/src/homeEconomics/submitDecision.test.ts`

**Interface:**

```ts
export const saveAdvancedHouseholdDecisionWithAdminSdk = async (input: {
  lessonRunId: string
  householdId: string
  decision: Omit<HouseholdDecisionRecord, 'submittedAtServerMillis'>
  expectedSynchronizedRoundIndex: number
  assignmentRevision: number
  idempotencyKey: string
  nowMillis: number
}): Promise<HouseholdDecisionRecord>
```

- [ ] Add transaction tests: read idempotency, runtime control, household before write; require `OPEN`, matching assignmentRevision, and `state.roundIndex === control.synchronizedRoundIndex === expected...`.
- [ ] Add idempotency replay/payload mismatch tests.
- [ ] Add Callable tests: existing state -> stored `teamId` -> membership; missing state -> FROZEN assignment `teamId` -> membership -> ensure; another team's runtime household rejected.
- [ ] Add `SETTLING` rejection and Common regression tests.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- repository submitDecision onCall
```

- [ ] Implement guarded advanced decision write in one Firestore transaction sharing the same control document as bulk lock.
- [ ] Preserve current decision field validation and Common save path.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- repository submitDecision onCall
```

- [ ] Commit.

```bash
git add functions/src/lessonRuns/households/repository.ts functions/src/lessonRuns/households/repository.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts functions/src/homeEconomics/submitDecision.ts functions/src/homeEconomics/submitDecision.test.ts
git commit -m "feat: guard advanced household decisions"
```

### Task 6: Bulk operation を runtime targets と同期barrierへ一般化

**Files:**
- Modify: `functions/src/homeEconomics/bulkSettlementOperation.ts`
- Modify: `functions/src/homeEconomics/bulkSettlementOperation.test.ts`
- Modify: `functions/src/homeEconomics/bulkSettlement.ts`
- Modify: `functions/src/homeEconomics/bulkSettlement.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `src/lib/homeEconomics/bulkSettlement.ts`
- Modify: `src/lib/homeEconomics/bulkSettlement.test.ts`

**Interfaces:**

```ts
export type HouseholdBulkSettlementStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'FAILED'
  | 'COMPLETED'
  | 'CANCELLED'

export interface HouseholdBulkTarget {
  householdId: string
  teamId: string
  profileId: string
}

export interface HouseholdBulkItem {
  teamId: string
  profileId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  errorCode?: string
  errorMessage?: string
}

export interface HouseholdBulkSettlementOperation {
  operationId: string
  lessonRunId: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  assignmentRevision: number | null
  forceUnsubmitted: boolean
  households: Record<string, HouseholdBulkItem> // key = runtime householdId
  status: HouseholdBulkSettlementStatus
  // retain current lease/checkpoint/timestamp fields
}
```

- [ ] Add failing digest tests including sorted target triples, assignmentRevision, expectedRound, restoreGeneration, force flag, actor.
- [ ] Add `CANCELLED` terminal/unresolved/retryable tests.
- [ ] Add advanced bulk-start transaction test: `OPEN` + matching revision/round -> atomically create operation and set `SETTLING + activeOperationId`.
- [ ] Add preflight-cancel test: missing required decision with force=false -> operation `CANCELLED`, control `OPEN`, activeOperationId null before API reports validation failure.
- [ ] Add partial-failure test: some states may be N+1 but control stays SETTLING/N; retry skips SUCCEEDED.
- [ ] Add completion test: all items successful -> operation COMPLETED + control OPEN + activeOperationId null + synchronizedRoundIndex N+1 atomically.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- bulkSettlementOperation bulkSettlement onCall
```

- [ ] Enumerate Common compatibility targets from team IDs and advanced targets from FROZEN assignment entries. Ensure every target state before preflight.
- [ ] Keep Common v2 pre-settlement checkpoint. Until Task 7 lands, inject a fake advanced checkpoint writer in Task 6 unit tests rather than skipping checkpoint semantics.
- [ ] Make `processRoundCallable` reject advanced formats; bulk alone calls internal `processRoundWithAdminSdk`.
- [ ] Update client operation types.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- bulkSettlementOperation bulkSettlement onCall
npm test -- src/lib/homeEconomics/bulkSettlement.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/bulkSettlementOperation.ts functions/src/homeEconomics/bulkSettlementOperation.test.ts functions/src/homeEconomics/bulkSettlement.ts functions/src/homeEconomics/bulkSettlement.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/bulkSettlement.ts src/lib/homeEconomics/bulkSettlement.test.ts
git commit -m "feat: synchronize advanced household settlements"
```

### Task 7: Advanced checkpoint v3

**Files:**
- Modify: `functions/src/homeEconomics/householdCheckpoint.ts`
- Modify: `functions/src/homeEconomics/householdCheckpoint.test.ts`
- Modify: `functions/src/homeEconomics/bulkSettlement.ts`
- Modify: `functions/src/homeEconomics/bulkSettlement.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `src/lib/homeEconomics/checkpoints.ts`
- Modify: `src/lib/homeEconomics/checkpoints.test.ts`

**Interfaces:**

```ts
export interface HouseholdCheckpointTeamViewV3 {
  households: Record<string, HouseholdStateTeamView>
  householdOrder: string[]
}

export interface HouseholdCheckpointSnapshotV3 {
  schemaVersion: 3
  scope: 'ALL_HOUSEHOLDS'
  courseFormat: AdvancedHouseholdCourseFormat
  assignmentRevision: number
  restoreGeneration: number
  expectedRoundIndex: number
  householdIds: string[]
  householdStates: HouseholdState[]
  teamViews: Record<string, HouseholdCheckpointTeamViewV3>
  createdAtServerMillis: number
}
```

- [ ] Add v3 snapshot tests: all runtime households exactly once; MULTI team views do not overwrite siblings.
- [ ] Add idempotency test including revision/round/generation/sorted IDs.
- [ ] Add advanced manual-checkpoint rejection while SETTLING.
- [ ] Add Common schema-v2 regression.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- householdCheckpoint bulkSettlement onCall
```

- [ ] Load RTDB team views before the retryable Firestore snapshot transaction; inside transaction read run/idempotency/states and verify projection rounds match state before writing snapshot/manifest.
- [ ] Wire advanced PRE_SETTLEMENT bulk checkpoint to v3.
- [ ] Dispatch manual Common -> v2, advanced -> v3; preserve current PRIMARY/ASSISTANT checkpoint permission.
- [ ] Update client manifest union/metadata.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- householdCheckpoint bulkSettlement onCall
npm test -- src/lib/homeEconomics/checkpoints.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdCheckpoint.ts functions/src/homeEconomics/householdCheckpoint.test.ts functions/src/homeEconomics/bulkSettlement.ts functions/src/homeEconomics/bulkSettlement.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/checkpoints.ts src/lib/homeEconomics/checkpoints.test.ts
git commit -m "feat: add advanced household checkpoints"
```

### Task 8: v3 restore と unresolved bulk cancellation

**Files:**
- Modify: `functions/src/homeEconomics/householdRestore.ts`
- Modify: `functions/src/homeEconomics/householdRestore.test.ts`
- Modify: `functions/src/homeEconomics/bulkSettlementOperation.ts`
- Modify: `functions/src/homeEconomics/bulkSettlementOperation.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `src/lib/homeEconomics/checkpoints.ts`
- Modify: `src/lib/homeEconomics/checkpoints.test.ts`

**Interface:** retain the current external restore callable shape; dispatch internally by checkpoint schema version.

```ts
export const restoreHouseholdCheckpointWithAdminSdk = (input: {
  lessonRunId: string
  checkpointId: string
  actorUid: string
  reason: string
  idempotencyKey: string
  nowMillis: number
}): Promise<HouseholdRestoreOperationView>
```

- [ ] Add v3 restore test: assignmentRevision must equal current FROZEN revision; states restore; generation increments; control becomes checkpoint round / OPEN / no active op in same transaction.
- [ ] Add crash-safe projection retry test; generation must not increment twice.
- [ ] Add active-lease rejection.
- [ ] Add Common v2 and advanced v3 regression: inactive unresolved PENDING/RUNNING/FAILED operation is atomically `CANCELLED` during restore; old retry fails and next new bulk can start.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- householdRestore bulkSettlementOperation onCall
```

- [ ] Extend restore dispatcher; retain existing v2 semantics.
- [ ] v3 post-commit RTDB restore writes `households` + order and clears stale private computation log entries for restored runtime IDs.
- [ ] Add transaction helper for cancelling inactive unresolved operation; active lease remains a hard block.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- householdRestore bulkSettlementOperation onCall
npm test -- src/lib/homeEconomics/checkpoints.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdRestore.ts functions/src/homeEconomics/householdRestore.test.ts functions/src/homeEconomics/bulkSettlementOperation.ts functions/src/homeEconomics/bulkSettlementOperation.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/checkpoints.ts src/lib/homeEconomics/checkpoints.test.ts
git commit -m "feat: restore advanced household checkpoints"
```

### Task 9: Advanced RTDB team projection と initial publication

**Files:**
- Modify: `functions/src/homeEconomics/realtimeProjection.ts`
- Modify: `functions/src/homeEconomics/realtimeProjection.test.ts`
- Modify: `functions/src/homeEconomics/processRound.ts`
- Modify: `functions/src/homeEconomics/processRound.test.ts`
- Modify: `functions/src/homeEconomics/statusTransition.ts`
- Modify: `functions/src/homeEconomics/statusTransition.test.ts`
- Modify: `functions/src/lessonRuns/projections/publicProjection.ts`
- Modify: `functions/src/lessonRuns/projections/publicProjection.test.ts`
- Modify: `src/lib/lessonRuns/liveTypes.ts`
- Modify: `src/lib/lessonRuns/liveTypes.test.ts`

**Interface:**

```ts
export interface AdvancedHouseholdTeamStateView {
  courseFormat: AdvancedHouseholdCourseFormat
  synchronizedRoundIndex: number
  roundStatus: 'OPEN' | 'SETTLING'
  households: Record<string, {
    householdId: string
    profile: HouseholdProfilePublicView
    state: HouseholdStateTeamView
    submittedRoundIndex: number | null
  }>
  householdOrder: string[]
}
```

- [ ] Add projection privacy tests using `toHouseholdProfilePublicView()`; hidden profile fields absent.
- [ ] Add processRound projection tests: Common updates `.household`; advanced updates only its runtime entry and preserves sibling households.
- [ ] Add first-RUNNING post-transition test: after FROZEN commit, ensure all assigned states and publish initial team nodes so `/play` can detect household mode before settlement.
- [ ] Add public-projection regression: generic public state publication uses RTDB `update`, not whole-node `set`, preserving `economicFactors` and future comparison field.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- realtimeProjection processRound statusTransition publicProjection
npm test -- src/lib/lessonRuns/liveTypes.test.ts
```

- [ ] Implement advanced team view; keep Common `.household` unchanged.
- [ ] Extend processRound publication with course-format branch and server-read runtime control.
- [ ] Implement idempotent post-start initial projection outside Firestore transaction.
- [ ] Change generic public publication to `.update(state)` while retaining explicit allow-list builder.
- [ ] Hand-sync client live types.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- realtimeProjection processRound statusTransition publicProjection
npm test -- src/lib/lessonRuns/liveTypes.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/realtimeProjection.ts functions/src/homeEconomics/realtimeProjection.test.ts functions/src/homeEconomics/processRound.ts functions/src/homeEconomics/processRound.test.ts functions/src/homeEconomics/statusTransition.ts functions/src/homeEconomics/statusTransition.test.ts functions/src/lessonRuns/projections/publicProjection.ts functions/src/lessonRuns/projections/publicProjection.test.ts src/lib/lessonRuns/liveTypes.ts src/lib/lessonRuns/liveTypes.test.ts
git commit -m "feat: project advanced household team state"
```

### Task 10: Teacher dashboard projection を team-primary DTO へ一般化

**Files:**
- Modify: `functions/src/homeEconomics/teacherDashboard.ts`
- Modify: `functions/src/homeEconomics/teacherDashboard.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `src/lib/homeEconomics/teacherDashboard.ts`
- Modify: `src/lib/homeEconomics/teacherDashboard.test.ts`

**Interfaces:**

```ts
export interface HouseholdTeacherTeamRow {
  teamId: string
  teamDisplayName: string
  submittedCount: number
  totalHouseholds: number
  allSubmitted: boolean
  warnings: HouseholdTeacherWarning[]
  households: HouseholdTeacherRow[]
}

export interface HouseholdTeacherDashboard {
  lessonRunId: string
  subject: 'HOME_ECONOMICS'
  courseFormat: CourseFormat
  assignment: HouseholdAssignmentView | null
  restoreGeneration: number
  synchronizedRoundIndex: number | null
  roundStatus: 'OPEN' | 'SETTLING' | null
  currentRoundIndex: number | null
  householdsAligned: boolean
  updatedAtServerMillis: number
  teams: HouseholdTeacherTeamRow[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
  finalComparisonAvailable: boolean
}
```

- [ ] Add DTO tests: Common 1/team, ROLE/STAGE 1/team, MULTI many/team with x/y aggregation.
- [ ] Add health tests: SETTLING+misaligned is recoverable/info; OPEN+misaligned is ACTION_REQUIRED.
- [ ] Map active bulk errors by runtime household ID.
- [ ] Remove current non-Common Callable rejection in a failing test while retaining teacher/HOME_ECONOMICS auth.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- teacherDashboard onCall
npm test -- src/lib/homeEconomics/teacherDashboard.test.ts
```

- [ ] Generalize loader through compatibility/frozen assignment, runtime IDs, decisions/events, then group by team.
- [ ] Before RUNNING, return assignment preview without persisting simulation state.
- [ ] Update client mapper exactly.
- [ ] Verify GREEN.

```bash
npm test --workspace=functions -- teacherDashboard onCall
npm test -- src/lib/homeEconomics/teacherDashboard.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/teacherDashboard.ts functions/src/homeEconomics/teacherDashboard.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/teacherDashboard.ts src/lib/homeEconomics/teacherDashboard.test.ts
git commit -m "feat: generalize household teacher dashboard"
```

### Task 11: Assignment panel と advanced teacher controls

**Files:**
- Create: `src/components/homeEconomics/HouseholdAssignmentPanel.tsx`
- Create: `src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx`
- Modify: `src/components/teacher/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/teacher/HouseholdTeacherDashboard.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`
- Modify: `src/components/homeEconomics/HouseholdSettlementConfirmationModal.tsx`
- Modify: `src/components/homeEconomics/HouseholdSettlementConfirmationModal.test.tsx`
- Modify: `src/components/homeEconomics/HouseholdCheckpointModal.tsx`
- Modify: `src/components/homeEconomics/HouseholdCheckpointModal.test.tsx`

**Interface:**

```ts
export interface HouseholdAssignmentPanelProps {
  assignment: HouseholdAssignmentView
  isPrimaryTeacher: boolean
  isBusy: boolean
  onPrepare: () => Promise<void>
  onUpdate: (input: Omit<UpdateHouseholdAssignmentInput, 'lessonRunId' | 'idempotencyKey'>) => Promise<void>
}
```

- [ ] Add assignment-panel tests for UNPREPARED/STALE/READY/INVALID/FROZEN and role-gated controls.
- [ ] Add ROLE profile-selector/unused warning, STAGE coverage warning, MULTI display-order/no-removal tests.
- [ ] Add team-card tests for MULTI x/y progress and household errors.
- [ ] Add regression: advanced never renders individual settlement; Common still does.
- [ ] Add settlement modal tests for class target counts and exact missing team/profile labels.
- [ ] Add checkpoint modal test disabling incompatible assignmentRevision v3 restore.
- [ ] Verify RED.

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.test.tsx src/components/homeEconomics/HouseholdCheckpointModal.test.tsx
```

- [ ] Wire assignment APIs and generalized dashboard.
- [ ] Replace LessonControlRoom's non-Common unsupported alert with household dashboard for all four formats.
- [ ] Disable advanced manual checkpoint/new bulk during SETTLING; expose retry/restore according to lease state.
- [ ] Preserve Common individual action.
- [ ] Verify GREEN.

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.test.tsx src/components/homeEconomics/HouseholdCheckpointModal.test.tsx
```

- [ ] Commit.

```bash
git add src/components/homeEconomics/HouseholdAssignmentPanel.tsx src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx src/components/homeEconomics/HouseholdTeacherDashboard.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.test.tsx src/components/homeEconomics/HouseholdCheckpointModal.tsx src/components/homeEconomics/HouseholdCheckpointModal.test.tsx
git commit -m "feat: add advanced household teacher controls"
```

### Task 12: REFLECTION gate と安全な final comparison

**Files:**
- Modify: `functions/packages/household-public-content/src/index.ts`
- Modify: `functions/packages/household-public-content/src/index.test.ts`
- Create: `functions/src/homeEconomics/finalComparison.ts`
- Create: `functions/src/homeEconomics/finalComparison.test.ts`
- Modify: `functions/src/homeEconomics/statusTransition.ts`
- Modify: `functions/src/homeEconomics/statusTransition.test.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.test.ts`
- Modify: `src/lib/lessonRuns/liveTypes.ts`
- Modify: `src/lib/lessonRuns/liveTypes.test.ts`

**Interfaces:**

```ts
export interface HouseholdClassComparisonHouseholdView {
  profileId: string
  profile: HouseholdProfilePublicView
  cashYen: number
  totalAssetsYen: number
  totalLiabilitiesYen: number
  goalDelayedRounds: number
  lifeGoalAchievementScore: number
}

export interface HouseholdClassComparisonTeamView {
  teamDisplayName: string
  households: HouseholdClassComparisonHouseholdView[]
}

export interface HouseholdClassComparisonPublicView {
  courseFormat: AdvancedHouseholdCourseFormat
  finalRoundCount: number
  publishedAtMillis: number
  teams: HouseholdClassComparisonTeamView[]
}
```

Persist source at `lessonRuns/{lessonRunId}/householdFinalComparison/result`.

- [ ] Add public-content/privacy tests; no runtime household ID, participant identity, risk/probability/seed fields.
- [ ] Add pure comparison tests using `computeLifeGoalAchievementScore()` and safe totals/team display names.
- [ ] Add REFLECTION gate tests: reject SETTLING, active operation, synchronizedRoundIndex=0, unresolved bulk, or misaligned household rounds.
- [ ] Add transition test: final safe snapshot writes in the same transaction as RUNNING->REFLECTION; RTDB publication occurs only after commit.
- [ ] Add deduplicated transition repair test: persisted snapshot republishes without settlement/state rewrite.
- [ ] Verify RED.

```bash
npm test --workspace=@stock-league/household-public-content
npm test --workspace=functions -- finalComparison statusTransition transitionPhase
```

- [ ] Build comparison through explicit allow-list and `toHouseholdProfilePublicView()`; never spread internal profile/state objects.
- [ ] Extend REFLECTION preparation to read assignment/control/team display names/states/unresolved bulk before write and return final snapshot write.
- [ ] Post-commit publication uses RTDB `update({ householdClassComparison: safeView })`.
- [ ] Add optional comparison field to client public live state.
- [ ] Verify GREEN.

```bash
npm test --workspace=@stock-league/household-public-content
npm test --workspace=functions -- finalComparison statusTransition transitionPhase
npm test -- src/lib/lessonRuns/liveTypes.test.ts
```

- [ ] Commit.

```bash
git add functions/packages/household-public-content/src/index.ts functions/packages/household-public-content/src/index.test.ts functions/src/homeEconomics/finalComparison.ts functions/src/homeEconomics/finalComparison.test.ts functions/src/homeEconomics/statusTransition.ts functions/src/homeEconomics/statusTransition.test.ts functions/src/lessonRuns/phases/transitionPhase.ts functions/src/lessonRuns/phases/transitionPhase.test.ts src/lib/lessonRuns/liveTypes.ts src/lib/lessonRuns/liveTypes.test.ts
git commit -m "feat: publish household class comparison"
```

### Task 13: Advanced student screen と classroom comparison display

**Files:**
- Create: `src/components/homeEconomics/HouseholdClassComparisonView.tsx`
- Create: `src/components/homeEconomics/HouseholdClassComparisonView.test.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeamScreen.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeamScreen.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/lessonRuns/liveTypes.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.test.ts`
- Modify: `src/components/display/ClassroomDisplayPage.tsx`
- Modify: `src/components/display/ClassroomDisplayPage.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Create: `src/lib/homeEconomics/finalComparison.ts`
- Create: `src/lib/homeEconomics/finalComparison.test.ts`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx`

**Interfaces:**

```ts
export type LessonRunDisplayMode =
  | 'START'
  | 'LIVE'
  | 'END'
  | 'EXPLANATION'
  | 'HOUSEHOLD_COMPARISON'

export interface ShowHouseholdComparisonOnDisplayInput {
  lessonRunId: string
}

export const showHouseholdComparisonOnDisplayCallable
export const showHouseholdComparisonOnDisplay: (
  functions: Functions,
  input: ShowHouseholdComparisonOnDisplayInput,
) => Promise<void>
```

- [ ] Add student tests: ROLE/STAGE one case; MULTI stable tabs/order; selected runtime ID sent to decision API; all team members see team households; SETTLING read-only.
- [ ] Add automatic comparison test: REFLECTION + public comparison -> advanced student screen makes comparison the primary view without publish/reveal action.
- [ ] Add privacy rendering test: team display names and safe values visible; no member names/runtime household IDs.
- [ ] Add App route tests: `/play` detects household mode from own team state containing `.household` or `.households`; non-household fallback remains. Do not add a public `subject` field solely for routing.
- [ ] Add display server/client tests for `HOUSEHOLD_COMPARISON`. Update the exhaustive `DISPLAY_MODE_LABEL` in `LessonControlRoom` so typecheck remains exhaustive.
- [ ] Add Callable auth test: teacher with display-switch authority + existing final snapshot succeeds; student/unauthenticated/no snapshot rejects.
- [ ] Verify RED.

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx src/App.test.tsx src/components/display/ClassroomDisplayPage.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/lib/homeEconomics/finalComparison.test.ts
npm test --workspace=functions -- displayProjection onCall
```

- [ ] Generalize HouseholdTeamScreen over legacy Common single-household and advanced multi-household state.
- [ ] Add comparison component and automatic REFLECTION switch.
- [ ] Wire `/play` to HouseholdTeamScreen when own team state proves household mode.
- [ ] Add display mode to server/client types, ClassroomDisplayPage, and LessonControlRoom label. `showHouseholdComparisonOnDisplayCallable` reads `householdFinalComparison/result` server-side and writes only the persisted safe view; it never accepts comparison payload from client.
- [ ] Add teacher actions `クラス比較を見る` / `教室画面に表示`.
- [ ] Verify GREEN.

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx src/App.test.tsx src/components/display/ClassroomDisplayPage.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/lib/homeEconomics/finalComparison.test.ts
npm test --workspace=functions -- displayProjection onCall
```

- [ ] Commit.

```bash
git add src/components/homeEconomics/HouseholdClassComparisonView.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx src/components/homeEconomics/HouseholdTeamScreen.tsx src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/App.tsx src/App.test.tsx src/lib/lessonRuns/liveTypes.ts functions/src/lessonRuns/projections/displayProjection.ts functions/src/lessonRuns/projections/displayProjection.test.ts src/components/display/ClassroomDisplayPage.tsx src/components/display/ClassroomDisplayPage.test.tsx src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts functions/src/index.ts src/lib/homeEconomics/finalComparison.ts src/lib/homeEconomics/finalComparison.test.ts src/components/homeEconomics/HouseholdTeacherDashboard.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx
git commit -m "feat: add advanced household student comparison UI"
```

### Task 14: Security Rules、acceptance regression、全体verification

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`
- Modify: `test/database.rules.test.ts`
- Modify: `test/household-lifecycle.acceptance.test.ts`
- Modify: `test/lesson-lifecycle.acceptance.test.ts`
- Modify only if integration requires it: files already touched in Tasks 1–13

**Rule intent:** add explicit deny matches for new/expanded Firestore server-owned household data under `lessonRuns/{lessonRunId}` (`householdAssignment/{document=**}`, `householdAssignmentIdempotency/{document=**}`, `householdRuntime/{document=**}`, `householdFinalComparison/{document=**}`, `households/{document=**}`). Do not widen RTDB visibility classes.

- [ ] Add Firestore Rules tests: student/client teacher cannot directly read/write assignment config/entries, runtime control, final source, household states/decisions/idempotency.
- [ ] Add RTDB Rules tests: participant reads own advanced team node but not another team's `households`; lesson participant can read sanitized public comparison; clients cannot write server-owned public/team nodes.
- [ ] Verify rules GREEN.

```bash
npm run test:rules
```

- [ ] Extend `test/household-lifecycle.acceptance.test.ts`: deterministic assignment -> first RUNNING/FROZEN -> decisions -> bulk -> next synchronized round -> v3 checkpoint -> restore -> bulk again -> REFLECTION -> automatic public comparison.
- [ ] Add acceptance cases for MULTI 2 profiles/team, STAGE fixed lifeStage, partial bulk retry, other-team denial, and Common legacy regression.
- [ ] Extend `test/lesson-lifecycle.acceptance.test.ts` only for first-start/resume/REFLECTION preparation behavior; explicitly cover `PAUSED -> RUNNING` preserving advanced control state.
- [ ] Run acceptance tests.

```bash
npm test -- test/household-lifecycle.acceptance.test.ts test/lesson-lifecycle.acceptance.test.ts
```

- [ ] Run Functions tests/typecheck.

```bash
npm test --workspace=functions
npm run typecheck --workspace=functions
```

- [ ] Run root unit tests/typecheck.

```bash
npm test
npm run typecheck
```

- [ ] Run full repository verification; completion requires exit 0.

```bash
npm run verify
```

- [ ] Inspect repository cleanliness.

```bash
git diff --check
git status --short
git log --oneline --decorate -15
```

- [ ] Commit any remaining rules/integration test changes.

```bash
git add firestore.rules test/firestore.rules.test.ts test/database.rules.test.ts test/household-lifecycle.acceptance.test.ts test/lesson-lifecycle.acceptance.test.ts
git commit -m "test: verify advanced household course formats"
```

- [ ] Push.

```bash
git push origin codex/classroom
```

## Agent Assignment and Parallelism

- **Agent A — assignment/runtime foundation:** Tasks 1–5 sequentially.
- **Agent B — settlement/recovery:** Tasks 6–8 after Task 5; Task 8 waits for Tasks 6–7.
- **Agent C — projection/teacher:** Task 10 can start after Tasks 2+4; Task 9 waits for Tasks 5+6; Task 11 waits for Tasks 2+10.
- **Agent D — reflection/student:** Task 12 waits for Tasks 3+6+8+9; Task 13 waits for Tasks 9+12.
- **Integration owner:** Task 14 after all feature tasks.

Safe parallel window after Task 5: Task 7's v3 snapshot domain and Task 10's generalized teacher DTO may proceed in parallel, provided shared `functions/src/homeEconomics/onCall.ts` changes are integrated serially. Pure UI work for Task 11 may start after the Task 10 client DTO is frozen.

Shared-file serialization order:

```text
functions/src/homeEconomics/onCall.ts:
Task 2 -> 5 -> 6 -> 7 -> 8 -> 10 -> 13

functions/src/index.ts:
Task 2 -> 13

functions/src/homeEconomics/statusTransition.ts:
Task 3 -> 9 -> 12

src/lib/lessonRuns/liveTypes.ts:
Task 9 -> 12 -> 13

src/components/teacher/LessonControlRoom.tsx:
Task 11 -> 13

src/components/homeEconomics/HouseholdTeacherDashboard.tsx:
Task 11 -> 13
```

Do not resolve shared-file conflicts blindly. Re-run the focused tests from every conflicting task after integration.

## Completion Criteria

- All 3 advanced formats prepare/validate/freeze/render according to approved deterministic rules.
- First RUNNING start freezes assignment; PAUSED->RUNNING never resets runtime control.
- FROZEN assignment is immutable; RUNNING late join only joins an existing team.
- Runtime householdId / source profileId / teamId are distinct and server-enforced.
- Advanced decisions cannot target another team and are rejected during SETTLING.
- Advanced rounds advance only by class-wide bulk; partial failure is resumable and never advances barrier early.
- v3 checkpoint/restore handles MULTI and safely cancels stale unresolved bulk.
- ROLE/STAGE/MULTI teacher dashboard and student UI work; Common external behavior remains compatible.
- RUNNING->REFLECTION is blocked until settled/aligned, then atomically persists a sanitized comparison and post-commit publishes it.
- Student devices automatically show comparison during REFLECTION; classroom display uses the same safe snapshot.
- Direct client access to server-owned assignment/runtime/final-source data is denied; RTDB team isolation remains intact.
- `npm run verify` passes and `codex/classroom` is pushed to origin.
