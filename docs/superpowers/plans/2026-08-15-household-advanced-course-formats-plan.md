# Household Advanced Course Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** `ROLE_VARIANT`、`STAGE_SPLIT`、`MULTI_PERSON_PER_TEAM` を、Run-scoped assignment、同期一括決算、v3 checkpoint/restore、教師・生徒UI、REFLECTION時の安全なクラス比較まで含めて実装し、既存 `COMMON_CONDITIONS` の外部契約を壊さない。

**Architecture:** 既存の household-centered runtime を維持し、その前段に LessonRun-scoped assignment を置く。教材の `HouseholdProfile.householdId` は論理的 `profileId`、実行単位は opaque な runtime `householdId`、認可単位は `teamId` として分離する。発展3形式は `householdRuntime/control` の `OPEN | SETTLING` と `synchronizedRoundIndex` でクラス全体を同期し、各 household の settlement は既存 `processRound` を内部 primitive として再利用する。`COMMON_CONDITIONS` は `householdId === teamId`、RTDB `.household`、個別決算、checkpoint v2 を維持する。

**Tech Stack:** Firebase Cloud Functions v2 / Firebase Admin SDK / Firestore / Realtime Database / TypeScript / React 19 / Vite / Vitest / Testing Library / Firebase Rules Unit Testing.

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-15-household-advanced-course-formats-design.md`。実装時に仕様判断を追加しない。
- 各 task 開始前に `docs/superpowers/scope-backlog.md` を読み直し、Phase 4 の対象が変わっていないことを確認する。
- Firestore transaction は **全 read を全 write より先に完了**する。transaction 内で RTDB / 外部I/Oを行わない。
- Callable の認可順は `auth -> LessonRun -> org/role/team ownership -> dependent assignment/profile/state reads -> mutation`。認可前に他teamのassignment詳細を返さない。
- 発展形式の学生認可では client-supplied `teamId` / `profileId` を信用しない。保存済み `HouseholdState.teamId`、state未作成時だけ FROZEN assignment の `teamId` を正本にする。
- 発展3形式は通常の個別決算を server-side で拒否する。`processRound` は bulk からだけ内部利用する。
- advanced decision と bulk lock は同じ `householdRuntime/control` document を transaction 内で読む/更新し、`OPEN -> SETTLING` を競合点にする。
- bulk の partial failure は正常な回復可能状態。barrier は進めず、成功済み item を再settleしない。
- restore は inactive な未完了 bulk を `CANCELLED` に終端化し、`restoreGeneration` を進める。active lease 中は restore を拒否する。
- `COMMON_CONDITIONS` の legacy state/checkpoint に `profileId` が無くても sole-profile fallback で動作させ、一括migrationを前提にしない。
- 学生向け profile / comparison は明示 allow-list のみ。`eventProbabilityOverrides`、`internalRiskFactors`、random seed、claim probability、runtime householdId、生徒氏名/UID/participantId を class-wide projection に出さない。
- 新しい application code の commit は task ごとに分ける。共有ファイルを触る task は後述の順序を守る。

---

### Task 1: Advisory validation と assignment pure domain を作る

**Files:**
- Create: `functions/src/homeEconomics/householdAssignment.ts`
- Create: `functions/src/homeEconomics/householdAssignment.test.ts`
- Modify: `functions/src/homeEconomics/templateValidation.ts`
- Modify: `functions/src/homeEconomics/templateValidation.test.ts`

**Interfaces:**

Consumes:

```ts
import type { CourseFormat, HomeEconomicsContent, HouseholdProfile } from '@stock-league/household-authoring-content'
```

Produces:

```ts
export type AdvancedHouseholdCourseFormat =
  | 'ROLE_VARIANT'
  | 'STAGE_SPLIT'
  | 'MULTI_PERSON_PER_TEAM'

export type HouseholdAssignmentState = 'DRAFT' | 'STALE' | 'FROZEN'
export type HouseholdAssignmentValidationStatus = 'READY' | 'INVALID'

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
  status: HouseholdAssignmentValidationStatus
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

export const getHomeEconomicsContentWarnings = (
  content: HomeEconomicsContent,
): string[]
```

- [ ] Write failing tests for deterministic ROLE_VARIANT round-robin, stable `runtimeHouseholdId`, and profile reuse when teams outnumber profiles.

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

- [ ] Write failing tests for STAGE_SPLIT: every distinct snapshot `lifeStage` gets one team first; insufficient teams returns `INVALID`; extra teams remain balanced; same-stage multiple profiles rotate deterministically.
- [ ] Write failing tests for MULTI: every team gets the exact complete profile set in snapshot order; runtime IDs differ across teams for the same profile; one-profile assignment validates `INVALID` for LessonRun start.
- [ ] Write failing tests for advisory template warnings: ROLE one profile warning only, STAGE one distinct stage warning only, MULTI one profile warning only; existing hard validation behavior remains unchanged.
- [ ] Run the focused tests and verify RED.

```bash
npm test --workspace=functions -- householdAssignment templateValidation
```

- [ ] Implement the pure assignment algorithms using sorted `teamId`, snapshot profile order, and `idempotencyDocumentId()` from `functions/src/lib/idempotency.ts`. Do not read Firestore in this module.
- [ ] Implement `getHomeEconomicsContentWarnings()` separately from `validateHomeEconomicsContent()` so warnings never become publish-blocking errors.
- [ ] Run focused tests and verify GREEN.

```bash
npm test --workspace=functions -- householdAssignment templateValidation
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdAssignment.ts functions/src/homeEconomics/householdAssignment.test.ts functions/src/homeEconomics/templateValidation.ts functions/src/homeEconomics/templateValidation.test.ts
git commit -m "feat: add household assignment domain"
```

### Task 2: Assignment persistence、PRIMARY callables、client wrapper を追加する

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
  warnings: Array<{ code: string; message: string }>
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
```

Callables:

```ts
export const getHouseholdAssignmentCallable
export const prepareHouseholdAssignmentCallable
export const updateHouseholdAssignmentCallable
```

- [ ] Write repository tests for initial prepare, replay with same idempotency key, payload mismatch rejection, revision increment, and STALE reconciliation preserving valid `MANUAL` entries.
- [ ] Add a fake transaction that throws if a `get()` occurs after the first `set()`/`delete()` and verify all assignment mutations obey read-before-write ordering.
- [ ] Write failing tests that `update` rejects FROZEN assignment and that MULTI rejects any `profileId` change but accepts display-order-only changes.
- [ ] Run repository tests and verify RED.

```bash
npm test --workspace=functions -- householdAssignmentRepository
```

- [ ] Implement paths exactly as:

```text
lessonRuns/{lessonRunId}/householdAssignment/config
lessonRuns/{lessonRunId}/householdAssignment/config/entries/{runtimeHouseholdId}
lessonRuns/{lessonRunId}/householdAssignmentIdempotency/{idempotencyDocumentId}
```

Use `requestDigest()` for request payloads; digest `entryIds` from sorted runtime IDs plus team/profile/order/source content.
- [ ] Implement `prepare` as both first-generation and STALE reconciliation. Do not create `HouseholdState` here.
- [ ] Add Callable tests proving: unauthenticated rejected; ASSISTANT/VIEWER cannot mutate; PRIMARY can mutate only a HOME_ECONOMICS run before RUNNING; teacher read projection is available to all teacher roles with `VIEW_PROGRESS`.
- [ ] Wire Cloud Functions exports in `functions/src/index.ts`.
- [ ] Add typed Firebase client wrappers using `httpsCallable` and matching server contracts exactly.
- [ ] Run focused server/client tests.

```bash
npm test --workspace=functions -- householdAssignmentRepository onCall
npm test -- src/lib/homeEconomics/householdAssignment.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdAssignmentRepository.ts functions/src/homeEconomics/householdAssignmentRepository.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts functions/src/index.ts src/lib/homeEconomics/householdAssignment.ts src/lib/homeEconomics/householdAssignment.test.ts
git commit -m "feat: add household assignment management"
```

### Task 3: RUNNING transition と assignment FROZEN を原子的に結合し、advanced late join を既存teamへ入れる

**Files:**
- Create: `functions/src/homeEconomics/statusTransition.ts`
- Create: `functions/src/homeEconomics/statusTransition.test.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.test.ts`
- Modify: `functions/src/lessonRuns/joinLessonRun.ts`
- Modify: `functions/src/lessonRuns/joinLessonRun.test.ts`

**Interfaces:**

Add to `TransitionPhaseDeps`:

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
```

Runtime control persisted at:

```text
lessonRuns/{lessonRunId}/householdRuntime/control
```

```ts
export interface HouseholdRuntimeControl {
  courseFormat: AdvancedHouseholdCourseFormat
  assignmentRevision: number
  synchronizedRoundIndex: number
  roundStatus: 'OPEN' | 'SETTLING'
  activeOperationId: string | null
  updatedAtServerMillis: number
}
```

- [ ] Write failing transition tests proving the preparation hook runs during `targetStatus: RUNNING`, all preparation reads finish before `appendLessonEventInTransaction`, and returned writes are committed in the same transaction as `LessonRun.status = RUNNING`.
- [ ] Write `statusTransition.test.ts` for ROLE/STAGE/MULTI start validation: current `meta/teamsIndex` must match `teamSetFingerprint`; assignment must not be STALE/INVALID; all entries/profiles valid; STAGE coverage complete; MULTI profile count >= 2 and complete set per team.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- statusTransition transitionPhase
```

- [ ] Implement the read-only preparation hook: read `teamsIndex`, config, every config `entryId`, validate, then return writes that set assignment `FROZEN` and initialize runtime control at round 0 / `OPEN`. Do not perform a write inside the hook itself.
- [ ] Modify `transitionPhase` so event/idempotency reads still occur before any preparation write is applied. Apply preparation writes only in the existing write phase.
- [ ] Ensure deduplicated transition calls still invoke `afterStatusTransition` so later RTDB repair can be retried without repeating Firestore transition writes.
- [ ] Write failing `joinLessonRun` tests: normal RUNNING join remains rejected; RUNNING join is allowed only when `subject === 'HOME_ECONOMICS'`, course format is one of the 3 advanced formats, assignment is FROZEN, and at least one existing team exists.
- [ ] Implement RUNNING advanced late join in the existing `joinLessonRun` transaction: read `meta/teamsIndex` and team docs, use existing `assignBalancedTeam`, create participant with `status: 'LATE_JOIN'` and `teamId`, and append participant to that team. Never create a new team.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- statusTransition transitionPhase joinLessonRun
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/statusTransition.ts functions/src/homeEconomics/statusTransition.test.ts functions/src/lessonRuns/phases/transitionPhase.ts functions/src/lessonRuns/phases/transitionPhase.test.ts functions/src/lessonRuns/joinLessonRun.ts functions/src/lessonRuns/joinLessonRun.test.ts
git commit -m "feat: freeze household assignments at lesson start"
```

### Task 4: `HouseholdState.profileId`、legacy COMMON normalization、assigned initializer を実装する

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

export type StoredHouseholdState = Omit<HouseholdState, 'profileId'> & {
  profileId?: string
}

export const resolveStoredHouseholdState = (input: {
  stored: StoredHouseholdState
  content: HomeEconomicsContent
}): HouseholdState

export const ensureAssignedHouseholdStateWithAdminSdk = (
  lessonRunId: string,
  householdId: string,
): Promise<HouseholdState>
```

- [ ] Write failing repository/normalization tests: new state requires `profileId`; legacy COMMON state with no profileId resolves to the only snapshot profile; advanced missing profileId fails closed.
- [ ] Update existing Common initialization tests to expect `profileId` while preserving `householdId === teamId`.
- [ ] Write assigned initializer tests: requires FROZEN entry; resolves source profile by `profileId`; creates state idempotently; existing state team/profile mismatch throws.
- [ ] Write processRound tests where runtime `householdId !== profileId` and verify the source profile is found via `HouseholdState.profileId`. Add STAGE test asserting lifeStage is unchanged after settlement.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- repository commonConditionsHousehold assignedHousehold processRound
```

- [ ] Implement `StoredHouseholdState` decoding at repository boundaries rather than making the business-domain `profileId` optional everywhere.
- [ ] Implement Common fallback only under `courseFormat === 'COMMON_CONDITIONS' && households.length === 1`; optionally backfill `profileId` on the next server write.
- [ ] Implement assigned initializer from FROZEN assignment; no client-derived team/profile input.
- [ ] Replace processRound's `householdId`-to-profile lookup with normalized `household.profileId`.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- repository commonConditionsHousehold assignedHousehold processRound
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/assignedHousehold.ts functions/src/homeEconomics/assignedHousehold.test.ts functions/src/lessonRuns/households/repository.ts functions/src/lessonRuns/households/repository.test.ts functions/src/homeEconomics/commonConditionsHousehold.ts functions/src/homeEconomics/commonConditionsHousehold.test.ts functions/src/homeEconomics/processRound.ts functions/src/homeEconomics/processRound.test.ts
git commit -m "feat: separate household runtime and profile identity"
```

### Task 5: Advanced decision 認可と `OPEN | SETTLING` transaction guard を実装する

**Files:**
- Modify: `functions/src/lessonRuns/households/repository.ts`
- Modify: `functions/src/lessonRuns/households/repository.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/homeEconomics/submitDecision.ts`
- Modify: `functions/src/homeEconomics/submitDecision.test.ts`

**Interfaces:**

Add an advanced guarded persistence function without weakening Common:

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

- [ ] Write transaction tests proving advanced decision persistence reads idempotency, runtime control, and household state before any write; requires `roundStatus === 'OPEN'`, matching assignment revision, and `state.roundIndex === control.synchronizedRoundIndex === expectedSynchronizedRoundIndex`.
- [ ] Write replay test proving same idempotency key/payload returns prior decision; changed payload rejects.
- [ ] Write Callable tests: existing state derives team ownership from `HouseholdState.teamId`; missing state derives team only from FROZEN assignment, verifies membership, then calls assigned initializer; other-team household ID is rejected.
- [ ] Write tests that `SETTLING` rejects new/updated decisions and Common continues through existing save behavior.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- repository submitDecision onCall
```

- [ ] Implement advanced decision guard in a single Firestore transaction sharing the runtime-control contention point with bulk lock.
- [ ] In `submitHouseholdDecisionCallable`, read LessonRun/course format after auth, branch Common vs advanced, and never accept a client team/profile identifier.
- [ ] Preserve all existing input validation in `submitDecision.ts`.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- repository submitDecision onCall
```

- [ ] Commit.

```bash
git add functions/src/lessonRuns/households/repository.ts functions/src/lessonRuns/households/repository.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts functions/src/homeEconomics/submitDecision.ts functions/src/homeEconomics/submitDecision.test.ts
git commit -m "feat: guard advanced household decisions"
```

### Task 6: Bulk operation を runtime household target と同期barrierへ一般化する

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
  households: Record<string, HouseholdBulkItem>
  status: HouseholdBulkSettlementStatus
  // retain existing lease/checkpoint/timestamp fields
}
```

- [ ] Write failing operation tests for target digest including sorted `{householdId, teamId, profileId}`, `assignmentRevision`, expected round, restoreGeneration, force flag, actor; same key with changed target set rejects.
- [ ] Write tests for `CANCELLED` as terminal and excluded by unresolved-operation finder/retryable view.
- [ ] Write advanced bulk-start transaction test: requires control `OPEN`, matching assignmentRevision/expected round; atomically creates operation and writes `SETTLING + activeOperationId`.
- [ ] Write preflight-cancel test: if any required decision is missing and `forceUnsubmitted === false`, operation is changed to `CANCELLED` and runtime control returns to `OPEN` before the API reports the validation error.
- [ ] Write partial failure tests: item settlement may leave some states at N+1, but control remains `SETTLING` and synchronized round remains N; retry skips `SUCCEEDED` items.
- [ ] Write completion transaction test: all items successful -> operation `COMPLETED` and control `OPEN`, `activeOperationId = null`, `synchronizedRoundIndex = N + 1` atomically.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- bulkSettlementOperation bulkSettlement onCall
```

- [ ] Generalize target enumeration: Common creates `{householdId: teamId, teamId, profileId}` targets through the compatibility resolver; advanced enumerates FROZEN assignment entries.
- [ ] Ensure all target households before preflight. For advanced use `ensureAssignedHouseholdStateWithAdminSdk`; Common keeps legacy-compatible ensure.
- [ ] Preserve existing pre-settlement checkpoint behavior for Common; advanced checkpoint call is supplied by Task 7. Until Task 7 lands, keep advanced pre-settlement checkpoint dependency injectable and make Task 6 tests use a fake v3 writer rather than bypassing checkpoint creation.
- [ ] Make `processRoundCallable` explicitly reject all 3 advanced formats while leaving internal `processRoundWithAdminSdk` available to bulk.
- [ ] Update client operation types without changing existing Common UI contract.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- bulkSettlementOperation bulkSettlement onCall
npm test -- src/lib/homeEconomics/bulkSettlement.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/bulkSettlementOperation.ts functions/src/homeEconomics/bulkSettlementOperation.test.ts functions/src/homeEconomics/bulkSettlement.ts functions/src/homeEconomics/bulkSettlement.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/bulkSettlement.ts src/lib/homeEconomics/bulkSettlement.test.ts
git commit -m "feat: synchronize advanced household settlements"
```

### Task 7: Advanced checkpoint v3 を追加する

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

export type HouseholdCheckpointManifest =
  | HouseholdCheckpointManifestV2
  | HouseholdCheckpointManifestV3
```

- [ ] Write failing tests that v3 snapshot stores every runtime household exactly once and groups RTDB-safe views under `teamId -> households` without overwriting MULTI entries.
- [ ] Write test that v3 idempotency digest includes assignmentRevision, expectedRoundIndex, restoreGeneration, and sorted runtime household IDs.
- [ ] Write test that a manual advanced checkpoint is rejected while `roundStatus === 'SETTLING'`.
- [ ] Write test that Common still writes schema v2 and existing manifest parsing remains valid.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- householdCheckpoint bulkSettlement onCall
```

- [ ] Implement v3 writer. Load current RTDB team projections before the Firestore snapshot transaction; inside the transaction read run/idempotency/all household states, validate projected round indices against state, then write snapshot+manifest. Never call RTDB from inside the retryable transaction.
- [ ] Wire advanced bulk PRE_SETTLEMENT checkpoint to v3 and remove the fake dependency used in Task 6 tests.
- [ ] Make manual checkpoint dispatch v2 for Common, v3 for advanced; keep current PRIMARY/ASSISTANT permission and add the advanced SETTLING guard.
- [ ] Update client manifest union and modal-facing metadata (`schemaVersion`, `assignmentRevision`, `householdCount`, `expectedRoundIndex`).
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- householdCheckpoint bulkSettlement onCall
npm test -- src/lib/homeEconomics/checkpoints.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdCheckpoint.ts functions/src/homeEconomics/householdCheckpoint.test.ts functions/src/homeEconomics/bulkSettlement.ts functions/src/homeEconomics/bulkSettlement.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/checkpoints.ts src/lib/homeEconomics/checkpoints.test.ts
git commit -m "feat: add advanced household checkpoints"
```

### Task 8: v3 restore と unresolved bulk cancellation を実装する

**Files:**
- Modify: `functions/src/homeEconomics/householdRestore.ts`
- Modify: `functions/src/homeEconomics/householdRestore.test.ts`
- Modify: `functions/src/homeEconomics/bulkSettlementOperation.ts`
- Modify: `functions/src/homeEconomics/bulkSettlementOperation.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `src/lib/homeEconomics/checkpoints.ts`
- Modify: `src/lib/homeEconomics/checkpoints.test.ts`

**Interfaces:**

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

- [ ] Write v3 restore test: checkpoint assignmentRevision must equal current FROZEN assignment revision; all state docs restore; `restoreGeneration` increments; runtime control restores `synchronizedRoundIndex = checkpoint.expectedRoundIndex`, `roundStatus = OPEN`, `activeOperationId = null` in the same Firestore transaction.
- [ ] Write crash-safe projection test: Firestore commit succeeds but RTDB publish fails -> restore operation remains `projectionStatus: PENDING`; retry with same idempotency key republishes without re-incrementing generation.
- [ ] Write test that active bulk lease blocks restore.
- [ ] Write regression test for both v2 Common and v3 advanced: an inactive unresolved `PENDING/RUNNING/FAILED` bulk operation is atomically set `CANCELLED` during restore, so old retry fails and a new bulk can be created afterward.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- householdRestore bulkSettlementOperation onCall
```

- [ ] Extend restore dispatcher by checkpoint schema version; preserve existing v2 semantics for Common.
- [ ] For v3 RTDB phase, restore `lessonRunTeamState/{run}/{teamId}.households` and `householdOrder`; clear/rebuild private computation logs for runtime IDs from the checkpoint set.
- [ ] Add `cancelUnresolvedBulkForRestoreInTransaction()` helper that only cancels operations with no live lease and is used by both v2 and v3 paths.
- [ ] Keep restore audit operation top-level/server-owned so it survives restored target writes.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- householdRestore bulkSettlementOperation onCall
npm test -- src/lib/homeEconomics/checkpoints.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/householdRestore.ts functions/src/homeEconomics/householdRestore.test.ts functions/src/homeEconomics/bulkSettlementOperation.ts functions/src/homeEconomics/bulkSettlementOperation.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/checkpoints.ts src/lib/homeEconomics/checkpoints.test.ts
git commit -m "feat: restore advanced household checkpoints"
```

### Task 9: Advanced RTDB team projection と initial publication を追加する

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

**Interfaces:**

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

- [ ] Write projection tests proving profile projection uses `toHouseholdProfilePublicView()` and excludes `eventProbabilityOverrides` / `internalRiskFactors`.
- [ ] Write processRound tests: Common continues updating `.household`; advanced updates only `households/{runtimeHouseholdId}` within its own team node and never overwrites sibling households.
- [ ] Write RUNNING post-transition test: after Firestore FROZEN commit, `afterStatusTransition` ensures all assigned states and publishes initial team projections, so `/play` can detect HOME_ECONOMICS before the first settlement.
- [ ] Write generic public-projection regression test: publishing ordinary `LessonRunPublicState` uses RTDB `update`, not `set`, so subject-specific fields such as `economicFactors` and later `householdClassComparison` survive timer/status refreshes.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- realtimeProjection processRound statusTransition publicProjection
npm test -- src/lib/lessonRuns/liveTypes.test.ts
```

- [ ] Implement `AdvancedHouseholdTeamStateView`; keep legacy Common `.household` path untouched.
- [ ] Extend processRound publication with course-format branch and update team-level `synchronizedRoundIndex`/`roundStatus` from persisted runtime control.
- [ ] Implement post-RUNNING initial publication as idempotent repair work outside the Firestore transition transaction.
- [ ] Change `publishLessonRunPublicStateWithAdminSdk` from whole-node `.set(state)` to `.update(state)` and preserve its explicit allow-list builder.
- [ ] Hand-sync client live types.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- realtimeProjection processRound statusTransition publicProjection
npm test -- src/lib/lessonRuns/liveTypes.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/realtimeProjection.ts functions/src/homeEconomics/realtimeProjection.test.ts functions/src/homeEconomics/processRound.ts functions/src/homeEconomics/processRound.test.ts functions/src/homeEconomics/statusTransition.ts functions/src/homeEconomics/statusTransition.test.ts functions/src/lessonRuns/projections/publicProjection.ts functions/src/lessonRuns/projections/publicProjection.test.ts src/lib/lessonRuns/liveTypes.ts src/lib/lessonRuns/liveTypes.test.ts
git commit -m "feat: project advanced household team state"
```

### Task 10: Teacher dashboard projection を team-primary DTO へ一般化する

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

- [ ] Write failing DTO tests for Common mapping to one household/team, ROLE/STAGE one household/team, and MULTI multiple households/team with `submittedCount/totalHouseholds` aggregation.
- [ ] Add partial failure health tests: `SETTLING + householdsAligned=false` is informational/recoverable; `OPEN + householdsAligned=false` produces `ACTION_REQUIRED`.
- [ ] Add active-bulk item error mapping by runtime household ID, not team ID.
- [ ] Add Callable test removing current non-Common rejection while preserving HOME_ECONOMICS and teacher auth checks.
- [ ] Verify RED.

```bash
npm test --workspace=functions -- teacherDashboard onCall
npm test -- src/lib/homeEconomics/teacherDashboard.test.ts
```

- [ ] Generalize loader to enumerate Common compatibility assignment or FROZEN advanced assignment, load states/decisions/events by runtime household ID, then group by team.
- [ ] For pre-RUNNING advanced dashboard, return assignment preview even when simulation state does not exist; do not persist states from dashboard reads.
- [ ] Update client mapper/types exactly.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=functions -- teacherDashboard onCall
npm test -- src/lib/homeEconomics/teacherDashboard.test.ts
```

- [ ] Commit.

```bash
git add functions/src/homeEconomics/teacherDashboard.ts functions/src/homeEconomics/teacherDashboard.test.ts functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts src/lib/homeEconomics/teacherDashboard.ts src/lib/homeEconomics/teacherDashboard.test.ts
git commit -m "feat: generalize household teacher dashboard"
```

### Task 11: Assignment panel と advanced teacher controls を実装する

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

**Interfaces:**

```ts
export interface HouseholdAssignmentPanelProps {
  assignment: HouseholdAssignmentView
  isPrimaryTeacher: boolean
  isBusy: boolean
  onPrepare: () => Promise<void>
  onUpdate: (input: Omit<UpdateHouseholdAssignmentInput, 'lessonRunId' | 'idempotencyKey'>) => Promise<void>
}
```

- [ ] Write assignment-panel tests for `UNPREPARED`, `STALE`, `READY`, `INVALID`, `FROZEN`; PRIMARY sees mutation controls, ASSISTANT/VIEWER do not.
- [ ] Write ROLE edit UI test with profile selector and unused-profile warning; STAGE coverage UI with missing-stage warning; MULTI display-order controls with no profile-removal control.
- [ ] Write dashboard tests for team cards/accordion, MULTI `2 / 3` team submission progress, class household submission totals, per-household errors.
- [ ] Write tests that advanced formats never render individual settlement, while Common still does.
- [ ] Write confirmation modal tests showing team/household counts and exact unsubmitted team/profile labels; force option remains PRIMARY-only.
- [ ] Write checkpoint modal test disabling assignmentRevision-incompatible v3 restore entries.
- [ ] Verify RED.

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.test.tsx src/components/homeEconomics/HouseholdCheckpointModal.test.tsx
```

- [ ] Wire teacher controller to assignment client APIs and generalized dashboard.
- [ ] Replace `LessonControlRoom`'s non-Common unsupported alert with the same household dashboard entry for all four course formats.
- [ ] Disable advanced manual checkpoint/new bulk controls while `SETTLING`; expose retry/restore according to operation lease state.
- [ ] Keep Common visual behavior and individual settlement action available.
- [ ] Run focused UI tests GREEN.

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.test.tsx src/components/homeEconomics/HouseholdCheckpointModal.test.tsx
```

- [ ] Commit.

```bash
git add src/components/homeEconomics/HouseholdAssignmentPanel.tsx src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx src/components/homeEconomics/HouseholdTeacherDashboard.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.tsx src/components/homeEconomics/HouseholdSettlementConfirmationModal.test.tsx src/components/homeEconomics/HouseholdCheckpointModal.tsx src/components/homeEconomics/HouseholdCheckpointModal.test.tsx
git commit -m "feat: add advanced household teacher controls"
```

### Task 12: REFLECTION gate と安全な final comparison を実装する

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

Persist server-owned snapshot at:

```text
lessonRuns/{lessonRunId}/householdFinalComparison/result
```

- [ ] Write public-content tests ensuring the class comparison type/projection does not contain runtime household ID, participant/student identity, risk/probability/seed fields.
- [ ] Write final-comparison pure tests using `computeLifeGoalAchievementScore()`; liabilities and assets are totals; team display names are preserved; ROLE grouping metadata can be derived by profile, STAGE by lifeStage, MULTI by profile/team.
- [ ] Write REFLECTION preparation tests: reject when runtime control is SETTLING, activeOperationId exists, synchronizedRoundIndex is 0, unresolved bulk exists, or any household round differs from synchronizedRoundIndex.
- [ ] Write transition test proving final comparison snapshot is written in the same transaction as successful RUNNING -> REFLECTION status change, but RTDB publication happens only after commit.
- [ ] Write post-transition retry test: deduplicated REFLECTION request republishes persisted safe snapshot without re-running settlement or rewriting final state.
- [ ] Verify RED.

```bash
npm test --workspace=@stock-league/household-public-content
npm test --workspace=functions -- finalComparison statusTransition transitionPhase
```

- [ ] Implement explicit allow-list builder using `toHouseholdProfilePublicView()` and existing evaluation function. Never spread internal profile/state objects into the public view.
- [ ] Extend status transition preparation for REFLECTION to read FROZEN assignment, runtime control, team display names, all household states, and unresolved bulk state before any write; return final snapshot write only when gate passes.
- [ ] Implement `afterStatusTransition` REFLECTION publication with RTDB `update({ householdClassComparison: safeView })`.
- [ ] Add optional `householdClassComparison` to client `LessonRunPublicState`.
- [ ] Run focused tests GREEN.

```bash
npm test --workspace=@stock-league/household-public-content
npm test --workspace=functions -- finalComparison statusTransition transitionPhase
```

- [ ] Commit.

```bash
git add functions/packages/household-public-content/src/index.ts functions/packages/household-public-content/src/index.test.ts functions/src/homeEconomics/finalComparison.ts functions/src/homeEconomics/finalComparison.test.ts functions/src/homeEconomics/statusTransition.ts functions/src/homeEconomics/statusTransition.test.ts functions/src/lessonRuns/phases/transitionPhase.ts functions/src/lessonRuns/phases/transitionPhase.test.ts src/lib/lessonRuns/liveTypes.ts
git commit -m "feat: publish household class comparison"
```

### Task 13: Advanced student screen と classroom comparison display を実装する

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
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Create: `src/lib/homeEconomics/finalComparison.ts`
- Create: `src/lib/homeEconomics/finalComparison.test.ts`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx`

**Interfaces:**

Extend display mode:

```ts
export type LessonRunDisplayMode =
  | 'START'
  | 'LIVE'
  | 'END'
  | 'EXPLANATION'
  | 'HOUSEHOLD_COMPARISON'
```

Callable/client:

```ts
export interface ShowHouseholdComparisonOnDisplayInput {
  lessonRunId: string
}

export const showHouseholdComparisonOnDisplayCallable
export const showHouseholdComparisonOnDisplay: (
  functions: Functions,
  input: ShowHouseholdComparisonOnDisplayInput,
) => Promise<void>
```

- [ ] Write `HouseholdTeamScreen` tests: ROLE/STAGE render one assigned case; MULTI renders stable tabs/cards in `householdOrder`; selected household ID is passed to `submitHouseholdDecision`; all team members see all team households; `SETTLING` makes inputs read-only.
- [ ] Write automatic comparison test: when `LessonRun.status === 'REFLECTION'` and public comparison exists, advanced student screen switches its primary content to `HouseholdClassComparisonView` without a student publish/reveal action.
- [ ] Write privacy/UI test proving comparison renders team display name and safe profile/result values but has no member names or runtime household IDs.
- [ ] Write `App` route tests: `/play` detects HOME_ECONOMICS from own team state containing `.household` or `.households`, renders `HouseholdTeamScreen`, and leaves the existing non-household/social-studies fallback unchanged. Do not add a new public `subject` field solely for routing.
- [ ] Write display projection/page tests for `HOUSEHOLD_COMPARISON` using the persisted safe comparison only.
- [ ] Write Callable auth tests: authenticated teacher with display-switch authority can show an existing final comparison; student/unauthenticated/no-comparison requests reject.
- [ ] Verify RED.

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx src/App.test.tsx src/components/display/ClassroomDisplayPage.test.tsx src/lib/homeEconomics/finalComparison.test.ts
npm test --workspace=functions -- displayProjection onCall
```

- [ ] Generalize `HouseholdTeamScreen` to consume legacy Common single-household and advanced multi-household team state without changing Common submit behavior.
- [ ] Add comparison component and auto-switch on REFLECTION.
- [ ] Wire `/play` to the household screen when own team state proves a household run; preserve other subject routes/fallbacks.
- [ ] Add display mode, server Callable, client wrapper, teacher `クラス比較を見る / 教室画面に表示` actions. The server reads `householdFinalComparison/result`; it never accepts comparison payload from the client.
- [ ] Run focused tests GREEN.

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx src/App.test.tsx src/components/display/ClassroomDisplayPage.test.tsx src/lib/homeEconomics/finalComparison.test.ts
npm test --workspace=functions -- displayProjection onCall
```

- [ ] Commit.

```bash
git add src/components/homeEconomics/HouseholdClassComparisonView.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx src/components/homeEconomics/HouseholdTeamScreen.tsx src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/App.tsx src/App.test.tsx src/lib/lessonRuns/liveTypes.ts functions/src/lessonRuns/projections/displayProjection.ts functions/src/lessonRuns/projections/displayProjection.test.ts src/components/display/ClassroomDisplayPage.tsx src/components/display/ClassroomDisplayPage.test.tsx functions/src/homeEconomics/onCall.ts functions/src/homeEconomics/onCall.test.ts functions/src/index.ts src/lib/homeEconomics/finalComparison.ts src/lib/homeEconomics/finalComparison.test.ts src/components/homeEconomics/HouseholdTeacherDashboard.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx
git commit -m "feat: add advanced household student comparison UI"
```

### Task 14: Security Rules、acceptance regression、全体verification を完了する

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`
- Modify: `test/database.rules.test.ts`
- Modify: `test/household-lifecycle.acceptance.test.ts`
- Modify: `test/lesson-lifecycle.acceptance.test.ts`
- Modify as required by integration failures: files touched in Tasks 1–13 only

**Security rule intent:**

Under `lessonRuns/{lessonRunId}`, add explicit deny matches for the new/expanded server-owned runtime data so future broad lessonRun rules cannot accidentally expose them:

```text
householdAssignment/{document=**}
householdAssignmentIdempotency/{document=**}
householdRuntime/{document=**}
householdFinalComparison/{document=**}
households/{document=**}
```

Do not widen Realtime Database visibility classes; comparison lives under already participant-readable `lessonRunPublic`, and multi-household private team state remains under already own-team-scoped `lessonRunTeamState/{runId}/{teamId}`.

- [ ] Add Firestore rules tests proving students and ordinary client teachers cannot directly read/write assignment config/entries, runtime control, final-comparison source document, household state/decisions/idempotency. Verify server-side code remains Admin SDK only.
- [ ] Add RTDB rules tests proving a participant can read own advanced team node but not another team's `households`; all lesson participants can read the sanitized public comparison; clients still cannot write server-owned lesson public/team nodes.
- [ ] Run rules tests and verify GREEN.

```bash
npm run test:rules
```

- [ ] Extend `test/household-lifecycle.acceptance.test.ts` with an advanced happy path: deterministic assignment -> RUNNING/FROZEN -> two-team decisions -> bulk -> next synchronized round -> v3 checkpoint -> restore -> bulk again -> REFLECTION -> public comparison.
- [ ] Add acceptance cases for MULTI two profiles/team, STAGE fixed `lifeStage`, partial bulk retry, other-team decision denial, and Common legacy regression.
- [ ] Extend `test/lesson-lifecycle.acceptance.test.ts` only where RUNNING/REFLECTION preparation hooks change lifecycle expectations; retain all non-household lifecycle cases unchanged.
- [ ] Run household/lifecycle acceptance tests.

```bash
npm test -- test/household-lifecycle.acceptance.test.ts test/lesson-lifecycle.acceptance.test.ts
```

- [ ] Run Functions tests and typecheck.

```bash
npm test --workspace=functions
npm run typecheck --workspace=functions
```

- [ ] Run root unit tests and typecheck.

```bash
npm test
npm run typecheck
```

- [ ] Run full repository verification. Do not claim completion unless this exits 0.

```bash
npm run verify
```

- [ ] Inspect `git diff --check`, `git status`, and commits. No generated build artifacts, emulator data, or unrelated files should remain.

```bash
git diff --check
git status --short
git log --oneline --decorate -15
```

- [ ] Commit only integration/rules fixes that are not already committed in prior tasks.

```bash
git add firestore.rules test/firestore.rules.test.ts test/database.rules.test.ts test/household-lifecycle.acceptance.test.ts test/lesson-lifecycle.acceptance.test.ts
git commit -m "test: verify advanced household course formats"
```

- [ ] Push the completed implementation branch.

```bash
git push origin codex/classroom
```

## Agent Assignment and Parallelism

- **Agent A — assignment/runtime foundation:** Tasks 1–5. These are sequential because persistence, transition freeze, runtime identity, and decision locking share contracts.
- **Agent B — settlement/recovery:** Tasks 6–8 after Task 5. Task 8 depends on Task 7 and the `CANCELLED` operation semantics from Task 6.
- **Agent C — projection/teacher UI:** Task 10 can begin after Tasks 2 and 4 once DTO identity is stable; Task 9 must wait for Tasks 5–6. Task 11 waits for Tasks 2 and 10.
- **Agent D — reflection/student UI:** Task 12 waits for Tasks 3, 6, 8, 9. Task 13 waits for Tasks 9 and 12.
- **Integration owner:** Task 14 after all feature tasks.

Safe parallel window after Task 5: Task 7's v3 snapshot domain and Task 10's generalized teacher DTO may proceed in parallel, provided neither edits shared `functions/src/homeEconomics/onCall.ts` until serial integration. Task 11's pure UI tests may also start after Task 10 DTO is frozen.

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

src/components/homeEconomics/HouseholdTeacherDashboard.tsx:
Task 11 -> 13
```

Do not merge parallel work by blindly resolving conflicts. Re-run the focused tests named in both conflicting tasks after integration.

## Completion Criteria

Implementation is complete only when all of the following are true:

- All three advanced formats can prepare, validate, freeze, and render assignments according to the approved deterministic rules.
- FROZEN assignment is immutable during RUNNING; RUNNING late join only joins an existing team.
- Runtime `householdId`, template `profileId`, and ownership `teamId` are distinct and enforced server-side.
- Advanced decisions are rejected during SETTLING and cannot target another team.
- Advanced rounds advance only by class-wide bulk; partial failure is resumable and never advances the class barrier early.
- v3 checkpoint/restore works for MULTI and cancels stale unresolved bulk operations safely.
- ROLE/STAGE/MULTI teacher dashboard and student UI are operational; Common external behavior remains compatible.
- RUNNING -> REFLECTION is blocked until an advanced run is settled/aligned, then automatically persists and publishes a sanitized comparison.
- All student devices automatically show comparison in REFLECTION; projector uses the same safe snapshot.
- Direct client access to server-owned assignment/runtime/final-source data is denied, and RTDB team isolation remains intact.
- `npm run verify` passes and `codex/classroom` is pushed to origin.
