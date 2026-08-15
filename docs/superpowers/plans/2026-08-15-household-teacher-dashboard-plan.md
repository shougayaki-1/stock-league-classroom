# 家庭科・教師用授業運用ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` to execute this plan task-by-task. Before claiming completion, use `superpowers:verification-before-completion`.

**Goal:** Phase 4 家庭科モードの教師UIを、`HOME_ECONOMICS` / `COMMON_CONDITIONS` の授業で実運用できる状態へ拡張する。既存 `LessonControlRoom` 内で、全家庭の状態・提出状況・警告を把握し、個別/一括/強制決算、手動/自動チェックポイント、全家庭の安全な復元を行えるようにする。

**Architecture:** Firestore の `HouseholdState` と意思決定・`ROUND_SETTLED` イベントを正本とし、教師画面は新しい server-authoritative Callable から allow-list 済みの運用ビューだけを取得する。`lessonRunPrivate` のクライアント権限は広げない。一括決算はトップレベル operation record + lease + item 状態で冪等に管理し、チェックポイントは v2 の全家庭 snapshot + safe team projection を保存する。復元は Firestore を1 transactionで戻した後、RTDB safe projection を再試行可能に同期する。

**Tech Stack:** TypeScript, React, MUI, Firebase Cloud Functions v2, Firestore Admin SDK, Realtime Database Admin SDK, Firebase client SDK, Vitest, React Testing Library, Firebase Emulator rules tests.

**Design source:** `docs/superpowers/specs/2026-08-15-household-teacher-dashboard-design.md`

## Global Constraints

1. **対象形式を広げない。** 今回の操作対象は `HOME_ECONOMICS` かつ `COMMON_CONDITIONS` のみ。`ROLE_VARIANT` / `STAGE_SPLIT` / `MULTI_PERSON_PER_TEAM` は未対応表示に留める。
2. **認可前に従属データを読まない。** 教師 Callable は必ず `auth → scalar validation → LessonRun read → teacherRoles → active org membership → household/decision/event/checkpoint/operation reads` の順にする。
3. **クライアント入力を所有権・対象列挙の正本にしない。** householdIds、提出済み状態、team state、reference state はクライアントから受け取らない。対象チーム/家庭はサーバーで列挙する。
4. **`lessonRunPrivate` を通常教師UIのデータ源にしない。** `randomSeed`、`internalRiskFactors`、`internalClaimProbability`、非公開係数、未公開イベント、private computation log 全体を dashboard response に含めない。
5. **既存の RTDB visibility 分離を維持する。** `lessonRunPublic` は全体公開、`lessonRunTeamState` は team-safe、`lessonRunPrivate` は内部情報。Firestore/RTDB Rules の読取権限を今回のUIのために広げない。
6. **FireStore transaction は全 read を全 write より先に行う。** helper 内の `appendLessonEventInTransaction` が行う read も含め、呼び出し後に追加 read をしない。
7. **重要操作は冪等。** 既存 `idempotencyDocumentId` / `requestDigest` を利用する。同一 key + 同一 payload は replay、同一 key + 異なる payload は `failed-precondition`。
8. **Bulk operation は lease を持つ。** Callable 異常終了で永久 `RUNNING` にしない。成功済み item は retry で再処理しない。
9. **通常一括決算は未提出が1件でもあれば household/checkpoint mutation 前に止める。** operation metadata の作成/失敗記録は許容するが、家庭状態は進めない。
10. **強制決算は明示操作だけ。** 未提出家庭だけ `forceSettle` 相当を使い、提出済み家庭を forced 扱いにしない。`ROUND_SETTLED` event に `forcedSettlement` を記録する。
11. **Duplicate settlement で stale RTDB を再投影しない。** Firestore commit が `ALREADY_SETTLED` の場合は計算済みの古い result を publish しない。
12. **Checkpoint v2 は `ALL_HOUSEHOLDS` のみワンクリック復元対象。** v1 は後方デコード可能に残すが、新UIの復元候補へ出さない。
13. **復元前に PRE_RESTORE checkpoint を1つだけ作る。** restore request の idempotency key から決定的に checkpoint key を導出する。
14. **復元は decision history を消さない。** current `roundIndex` に一致する意思決定だけが自然に採用される既存 repository セマンティクスを維持する。
15. **RTDB restore sync は retryable。** Firestore restore commit 後に team-safe projection と stale private log 削除を同期し、成功後だけ `projectionStatus='SYNCED'` にする。
16. **既存画面の社会科動作を壊さない。** SOCIAL_STUDIES では household dashboard Callable を呼ばない。
17. **既存コードの無関係なリファクタをしない。** `HouseholdRoundControlPanel` は新UIから使わなくなっても、この計画では削除しない。
18. **各タスクのテストを先に落とす。** failure を確認してから最小実装を行い、対象テストを緑にしてからコミットする。

## Shared Contracts

サーバー側の canonical contract は以下とする。client wrapper は同じ shape を手同期する。

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
  activeLiabilities: Record<string, {
    remainingPrincipalYen: number
    remainingYears: number
  }>
  lastSettlementSummary: {
    roundIndex: number
    incomeYen: number
    expensesYen: number
    netCashFlowYen: number
    shortfallYen: number
    insuranceBenefitsYen: number
  } | null
  goalDelayedRounds: number
  revealedEvents: Array<{
    eventId: string
    label: string | null
    effectDescription: string | null
  }>
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
```

Bulk request/result contract:

```ts
export interface ProcessHouseholdRoundBatchRequest {
  lessonRunId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  idempotencyKey: string
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
```

Checkpoint v2 contract:

```ts
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

- **Task 1 — Claude:** COMMON_CONDITIONS 初期化共通化 + 単体決算の duplicate/監査安全化
- **Task 2 — Codex:** Bulk operation repository + lease
- **Task 3 — Claude:** Checkpoint v2 snapshot/manifest/write helper
- **Task 4 — Codex:** Teacher dashboard server projection + Callable
- **Task 5 — Claude:** Bulk settlement orchestrator + Callable
- **Task 6 — Codex:** Atomic household restore + RTDB projection retry
- **Task 7 — Antigravity:** Client wrappers/types
- **Task 8 — Codex:** HouseholdTeacherDashboard React UI
- **Task 9 — Claude:** App / LessonControlRoom integration and subject/course-format gating
- **Task 10 — Codex:** Rules denial, acceptance regression, backlog update, full verification

Dependency waves:

- **Wave 1:** Task 1
- **Wave 2:** Task 2 and Task 3 in parallel
- **Wave 3:** Task 4, Task 5, Task 6 in parallel after Tasks 1–3
- **Wave 4:** Task 7 after Tasks 4–6
- **Wave 5:** Task 8 after Task 7
- **Wave 6:** Task 9 after Task 8
- **Wave 7:** Task 10 after all prior tasks

---

## Task 1: Extract COMMON_CONDITIONS initialization and harden single-household settlement

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

**Consumes:** `HomeEconomicsContent`, `HouseholdState`, `getOrInitHouseholdState`, `householdRepositoryWithAdminSdk`, current `processRound` flow.

**Produces:** one shared COMMON_CONDITIONS initialization path; explicit settlement commit status; `forcedSettlement` audit field; no stale RTDB publish on duplicate.

### Step 1.1 — Extract pure initial-state construction

- [ ] Add failing tests in `repository.test.ts` proving the initial state shape is exactly the current shape: starting cash/life stage, empty assets/insurance/liabilities, round 0, goal delay 0.
- [ ] Run `npm --prefix functions test -- src/lessonRuns/households/repository.test.ts` and verify failure.
- [ ] Export a pure helper from `repository.ts` and make `getOrInitHouseholdState` call it instead of duplicating the object literal.

Required signature:

```ts
export interface BuildInitialHouseholdStateInput {
  lessonRunId: string
  teamId: string
  householdId: string
  startingCashYen: number
  startingLifeStage: string
  nowMillis: number
}

export const buildInitialHouseholdState = (
  input: BuildInitialHouseholdStateInput,
): HouseholdState => ({
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

- [ ] Re-run the repository test and verify pass.

### Step 1.2 — Centralize COMMON_CONDITIONS profile resolution

- [ ] Add failing tests for: one profile + COMMON_CONDITIONS succeeds; wrong format fails; profile count other than one fails; preview does not write; ensure is idempotent.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/commonConditionsHousehold.test.ts` and verify failure.
- [ ] Implement `commonConditionsHousehold.ts` with a pure preview and Admin SDK ensure helper.

Required public surface:

```ts
export interface CommonConditionsHouseholdSource {
  lessonRunId: string
  teamId: string
  homeEconomics: HomeEconomicsContent
  nowMillis: number
}

export const previewCommonConditionsHouseholdState = (
  input: CommonConditionsHouseholdSource,
): HouseholdState => {
  const content = input.homeEconomics
  if (content.courseFormat !== 'COMMON_CONDITIONS' || content.households.length !== 1) {
    throw new Error('Unsupported home-economics course format for automatic household initialization')
  }
  const profile = content.households[0]
  return buildInitialHouseholdState({
    lessonRunId: input.lessonRunId,
    teamId: input.teamId,
    householdId: input.teamId,
    startingCashYen: profile.cashSavingsYen,
    startingLifeStage: profile.lifeStage,
    nowMillis: input.nowMillis,
  })
}

export const ensureCommonConditionsHouseholdStateWithAdminSdk = async (
  lessonRunId: string,
  teamId: string,
): Promise<HouseholdState> => {
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new Error('LessonRun not found')
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  if (!templateSnapshot?.homeEconomics) throw new Error('LessonRun has no homeEconomics content')
  const initial = previewCommonConditionsHouseholdState({
    lessonRunId,
    teamId,
    homeEconomics: templateSnapshot.homeEconomics,
    nowMillis: Date.now(),
  })
  return getOrInitHouseholdState({
    firestore: householdRepositoryWithAdminSdk(),
    lessonRunId,
    teamId,
    householdId: teamId,
    startingCashYen: initial.cashYen,
    startingLifeStage: initial.lifeStage,
    now: Date.now,
  })
}
```

- [ ] Replace `onCall.ts`'s local `lazyInitHouseholdWithAdminSdk` initialization logic with this helper after the existing `requireTeamMembership` check. Do not weaken student authorization.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/commonConditionsHousehold.test.ts src/homeEconomics/onCall.test.ts` and verify pass.

### Step 1.3 — Make settlement commit outcome explicit

- [ ] Add failing `processRound.test.ts` cases for duplicate/concurrent settlement: transaction observes different `roundIndex`; no RTDB publish occurs; authoritative current household is returned.
- [ ] Add failing case that a missing decision with explicit force writes `forcedSettlement: true`, while submitted decisions write `false` even if the outer bulk request is force-capable.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/processRound.test.ts` and verify failure.
- [ ] Change the commit contract to an explicit discriminated union.

```ts
export type CommitRoundSettlementResult =
  | { status: 'COMMITTED' }
  | { status: 'ALREADY_SETTLED'; householdState: HouseholdState }

export type ProcessRoundExecutionResult =
  | { status: 'COMMITTED'; settlement: SettleRoundResult }
  | { status: 'ALREADY_SETTLED'; householdState: HouseholdState }
```

- [ ] `commitRoundSettlement` must return `ALREADY_SETTLED` with the transaction-read current state when CAS fails.
- [ ] `processRound` must call `publishRealtimeState` only on `COMMITTED`.
- [ ] Add `forcedSettlement: decision === null && input.forceSettle === true` to the `ROUND_SETTLED` event payload.
- [ ] Do not publish or recompute an old settlement result on `ALREADY_SETTLED`.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/processRound.test.ts src/homeEconomics/onCall.test.ts` and verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics functions/src/lessonRuns/households && git commit -m "feat: harden household settlement primitives"`

---

## Task 2: Add bulk settlement operation repository and lease

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/bulkSettlementOperation.ts`
- Create: `functions/src/homeEconomics/bulkSettlementOperation.test.ts`

**Consumes:** `idempotencyDocumentId`, `requestDigest`, Firestore Admin SDK.

**Produces:** server-only top-level `householdBulkSettlementOperations/{operationId}` repository, replay detection, item status persistence, lease/heartbeat helpers.

### Step 2.1 — Define operation model and deterministic ID

- [ ] Add failing tests for operation ID determinism and request digest mismatch.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlementOperation.test.ts` and verify failure.
- [ ] Implement these types exactly:

```ts
export type HouseholdBulkOperationStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED'
export type HouseholdBulkItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'

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

export const HOUSEHOLD_BULK_LEASE_MS = 60_000
```

- [ ] Derive `operationId` with `idempotencyDocumentId(lessonRunId, idempotencyKey)`; never use the raw key as a document ID.

### Step 2.2 — Implement create/replay and unresolved-operation checks

- [ ] Add failing tests for same key/same payload replay, same key/different payload rejection, a different key being blocked by an unresolved prior operation, and completed operation not blocking the next round.
- [ ] Implement repository functions whose dependency-injected core can be unit-tested without Firebase.
- [ ] New operation household item map must be created from server-supplied sorted team IDs, all initially `PENDING`.
- [ ] A stale expired `RUNNING` operation with a different idempotency key is still unresolved: do not silently create a second operation. The caller must retry/finalize the old operation first.

### Step 2.3 — Implement lease and item persistence

- [ ] Add failing tests for acquire, unexpired contention, expired reacquire by same operation, heartbeat extension, item SUCCEEDED preservation, final FAILED/COMPLETED status.
- [ ] Implement lease acquisition transactionally. Increment `attempt` only when a new lease is acquired.
- [ ] Heartbeat after each household item; `leaseExpiresAtServerMillis = now + HOUSEHOLD_BULK_LEASE_MS`.
- [ ] Expose two read concepts separately:
  - unresolved operation for preventing a new bulk operation with a different key;
  - unexpired active lease for blocking individual settlement/manual checkpoint/restore.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlementOperation.test.ts` and verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics/bulkSettlementOperation* && git commit -m "feat: add household bulk operation lease"`

---

## Task 3: Add Household Checkpoint v2 and server-derived checkpoint writer

**Owner:** Claude

**Files:**
- Create: `functions/src/homeEconomics/householdCheckpoint.ts`
- Create: `functions/src/homeEconomics/householdCheckpoint.test.ts`
- Modify: `functions/src/homeEconomics/checkpointRestore.ts`
- Modify: `functions/src/homeEconomics/checkpointRestore.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`

**Consumes:** Task 1 common initialization helper, `writeCheckpointWithAdminSdk`, current RTDB `HouseholdStateTeamView`, `lessonRuns/{id}/meta/eventCounter`.

**Produces:** v2 snapshot codec, manifest filter, manual checkpoint Callable with server-derived household IDs/phase/sequence, internal PRE_SETTLEMENT/PRE_RESTORE writer.

### Step 3.1 — Define v2 codec and preserve v1 decoding

- [ ] Add failing tests for v2 construction, v2 validation, v1 recognition, malformed snapshot rejection, and manifest filtering.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdCheckpoint.test.ts src/homeEconomics/checkpointRestore.test.ts` and verify failure.
- [ ] Implement `HouseholdCheckpointSnapshotV2` from Shared Contracts.
- [ ] Keep the existing v1 interface decoder available for historical data/tests, but add an explicit v2 type guard:

```ts
export const isHouseholdCheckpointSnapshotV2 = (
  value: unknown,
): value is HouseholdCheckpointSnapshotV2 => {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Partial<HouseholdCheckpointSnapshotV2>
  return snapshot.schemaVersion === 2
    && snapshot.scope === 'ALL_HOUSEHOLDS'
    && Array.isArray(snapshot.householdIds)
    && Array.isArray(snapshot.households)
    && typeof snapshot.teamViews === 'object'
    && snapshot.teamViews !== null
}
```

- [ ] Dashboard manifest listing must include only v2 + `scope === 'ALL_HOUSEHOLDS'`.

### Step 3.2 — Build complete safe snapshot server-side

- [ ] Add failing tests that the client cannot inject household IDs or team views, and that missing HouseholdState is initialized from the Task 1 helper.
- [ ] The internal writer receives server-derived `householdIds`, but the public manual Callable does not.
- [ ] For each team, load current `HouseholdState`; initialize only if missing.
- [ ] Read `lessonRunTeamState/{lessonRunId}/{teamId}/household` from Admin RTDB.
- [ ] If a team projection is absent at `roundIndex === 0`, construct the exact allow-listed initial `HouseholdStateTeamView` with the existing `toHouseholdStateTeamView` helper, visible concepts, no occurred events, and no shortfall options. If projection is absent after round 0, fail with `failed-precondition`; do not silently synthesize historical disclosures.
- [ ] Never save `lessonRunPrivate` into the snapshot.

### Step 3.3 — Derive checkpoint phase/sequence on the server

- [ ] Replace the public manual checkpoint request with:

```ts
export interface WriteHouseholdCheckpointRequest {
  lessonRunId: string
  label: string
  idempotencyKey: string
}
```

- [ ] Validate `label.trim()` length 1–80 at the Callable boundary.
- [ ] Server reads `LessonRun.currentPhaseId`; use the explicit internal sentinel `__NO_PHASE__` when null.
- [ ] Server reads `lessonRuns/{lessonRunId}/meta/eventCounter`; use its `value` as the latest committed event sequence, or `-1` when no event has ever been written. This v2 server-only path may store `sequence=-1`; do not loosen the old client-provided legacy validation elsewhere.
- [ ] `createdAtServerMillis` is server time; `createdByUid` is request auth uid.
- [ ] Manual kind is always `MANUAL`. Internal callers pass `PRE_SETTLEMENT` or `PRE_RESTORE` explicitly.
- [ ] Before manual save, reject an unexpired bulk lease using Task 2.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdCheckpoint.test.ts src/homeEconomics/checkpointRestore.test.ts src/homeEconomics/onCall.test.ts` and verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics && git commit -m "feat: add household checkpoint v2"`

---

## Task 4: Build the teacher-safe dashboard projection and Callable

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/teacherDashboard.ts`
- Create: `functions/src/homeEconomics/teacherDashboard.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Consumes:** Task 1 preview helper, Task 2 operation repository, Task 3 checkpoint manifest, household decisions, teams, `ROUND_SETTLED` events.

**Produces:** `getHouseholdTeacherDashboardCallable` and allow-list dashboard response.

### Step 4.1 — Test the pure projection first

- [ ] Add failing unit tests with two aligned households, mismatched rounds, unsubmitted household, prior shortfall, prior bulk failure, restore event, and hidden future event input.
- [ ] Explicitly assert serialized response does not contain strings/keys `randomSeed`, `internalRiskFactors`, `internalClaimProbability`, `priceSensitivityPreset`, or unrevealed event IDs.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/teacherDashboard.test.ts` and verify failure.
- [ ] Implement pure builders for row warnings, settlement summary and dashboard summary.
- [ ] `currentRoundIndex` is the shared round only when every row has the same round; otherwise `null` and `householdsAligned=false`.
- [ ] `totalAssetsYen` is `Object.values(assetHoldingsYen).reduce((sum, value) => sum + value, 0)`; do not mix cash or insurance into asset allocation.

### Step 4.2 — Normalize team display names without assuming schema

- [ ] Enumerate `lessonRuns/{lessonRunId}/teams` server-side; document ID is canonical teamId.
- [ ] Treat `displayName` as optional. Normalize with this exact fallback:

```ts
export const normalizeTeamDisplayName = (
  teamId: string,
  data: Record<string, unknown>,
): string => {
  const value = data.displayName
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : teamId
}
```

- [ ] If HouseholdState is not yet persisted, build an in-memory preview using Task 1; the dashboard read itself must not create the document.
- [ ] For each row, read the latest decision for that row's own `roundIndex` using the existing repository function.
- [ ] Build `lastSettlementSummary` from latest matching `ROUND_SETTLED` event payload, not from `lessonRunPrivate`.
- [ ] Build `revealedEvents` only from the safe disclosure builder / already-safe team projection. Do not expose raw future event catalog entries.
- [ ] Checkpoint list uses Task 3 v2 manifests only.
- [ ] Latest relevant PENDING/RUNNING/FAILED bulk operation becomes `activeBulkOperation`; a current failed item adds `ACTION_REQUIRED` warning to that household.

### Step 4.3 — Add Callable with authorization-order tests

- [ ] Add failing tests proving unauthenticated requests make zero data reads, unauthorized/non-member teachers cannot trigger household/event/checkpoint reads, VIEWER can read after authorization, unsupported subject/format fails before subordinate reads.
- [ ] Implement `getHouseholdTeacherDashboardCallable` with request `{ lessonRunId: string }`.
- [ ] Required ordering: auth → non-empty lessonRunId validation → LessonRun read → teacher role exists → active membership → subject/format validation → projection reads.
- [ ] Unsupported `HOME_ECONOMICS` format returns `failed-precondition`; SOCIAL_STUDIES returns `failed-precondition` at the server even though Task 9 prevents the call in normal UI.
- [ ] Export Callable from `functions/src/index.ts`.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/teacherDashboard.test.ts src/homeEconomics/onCall.test.ts` and verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics functions/src/index.ts && git commit -m "feat: add household teacher dashboard api"`

---

## Task 5: Implement server-side bulk settlement orchestration

**Owner:** Claude

**Files:**
- Create: `functions/src/homeEconomics/bulkSettlement.ts`
- Create: `functions/src/homeEconomics/bulkSettlement.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Consumes:** Tasks 1–3, `processRoundWithAdminSdk`, `getHouseholdDecisionForRoundWithAdminSdk`.

**Produces:** `processHouseholdRoundBatchCallable`; normal/force all-household settlement; retryable partial failure.

### Step 5.1 — Write preflight failure tests

- [ ] Test invalid expectedRoundIndex, non-PRIMARY, inactive org member, non-RUNNING run, wrong subject, wrong course format, round mismatch, household round misalignment, unresolved older bulk operation, and missing submissions in normal mode.
- [ ] Verify normal missing-submission failure does not create a checkpoint and does not call `processRound` for any household.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlement.test.ts src/homeEconomics/onCall.test.ts` and verify failure.

### Step 5.2 — Implement deterministic preflight and operation creation

- [ ] Public request is exactly `ProcessHouseholdRoundBatchRequest` from Shared Contracts.
- [ ] Callable auth order follows Global Constraint 2.
- [ ] Server enumerates team docs; sort team IDs lexicographically before creating operation items and before processing.
- [ ] Create/replay the Task 2 operation using request digest over `{ expectedRoundIndex, forceUnsubmitted }` plus authoritative `restoreGeneration`.
- [ ] Acquire lease before mutating household state.
- [ ] Initialize every missing household with Task 1 helper.
- [ ] Re-read all household round indices and decisions after initialization.
- [ ] If any round differs from `expectedRoundIndex`, fail the operation and release lease.
- [ ] In normal mode, if any decision is missing, mark the corresponding item errors, finalize operation `FAILED`, and return a structured failed-precondition error without checkpoint/settlement mutation.

### Step 5.3 — Create PRE_SETTLEMENT checkpoint once

- [ ] Add failing replay test proving retry does not create another pre-settlement checkpoint.
- [ ] Derive checkpoint key deterministically from operation ID, e.g. `pre-settlement:${operationId}`.
- [ ] Call Task 3 internal writer with `kind='PRE_SETTLEMENT'`, label `第${expectedRoundIndex + 1}ラウンド 決算前`, all authoritative team IDs, and operation actorUid.
- [ ] Save returned checkpointId to operation record before first settlement item.

### Step 5.4 — Settle items and make retry crash-safe

- [ ] Add tests for: all success, one item throws, process crash after Firestore settlement but before item status write, same operation retry, restoreGeneration changed, expected round changed, expired lease reacquire.
- [ ] For each non-SUCCEEDED item:
  1. heartbeat;
  2. re-read current HouseholdState;
  3. if `roundIndex === expectedRoundIndex + 1`, treat the item as already successfully committed and mark SUCCEEDED without recomputing;
  4. if `roundIndex !== expectedRoundIndex`, fail that item/operation as incompatible;
  5. resolve current-round decision;
  6. call `processRoundWithAdminSdk` with `forceSettle = forceUnsubmitted && decision === null`;
  7. treat both `COMMITTED` and authoritative `ALREADY_SETTLED` at `expectedRoundIndex + 1` as SUCCEEDED;
  8. persist item status before moving to the next team.
- [ ] Never call force for a household with a submitted decision.
- [ ] After all items, `COMPLETED` iff every item is SUCCEEDED; otherwise `FAILED`.
- [ ] On retry, process only `PENDING | FAILED` items.
- [ ] Before retry, compare current `LessonRun.restoreGeneration` to operation value. A mismatch makes the operation non-resumable and finalizes failure.
- [ ] Return the safe operation view, not internal lease/requestDigest fields.
- [ ] Export Callable from `functions/src/index.ts`.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/bulkSettlement.test.ts src/homeEconomics/bulkSettlementOperation.test.ts src/homeEconomics/processRound.test.ts src/homeEconomics/onCall.test.ts` and verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics functions/src/index.ts && git commit -m "feat: orchestrate household round settlement"`

---

## Task 6: Replace home-economics restore with atomic v2 restore and retryable RTDB sync

**Owner:** Codex

**Files:**
- Create: `functions/src/homeEconomics/householdRestore.ts`
- Create: `functions/src/homeEconomics/householdRestore.test.ts`
- Modify: `functions/src/homeEconomics/onCall.ts`
- Modify: `functions/src/homeEconomics/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Consumes:** Task 2 lease check, Task 3 v2 snapshot/internal writer, `appendLessonEventInTransaction`.

**Produces:** all-household atomic Firestore restore; `householdCheckpointRestoreIdempotency` record; safe RTDB restore sync.

### Step 6.1 — Define dedicated home-economics restore idempotency

- [ ] Add failing tests for same key/same payload replay and same key/different checkpoint/reason rejection.
- [ ] Use a dedicated subcollection to avoid colliding with the Phase A generic restore flow:

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

### Step 6.2 — Reject unsafe restore candidates before mutation

- [ ] Add failing tests for v1 checkpoint, non-ALL_HOUSEHOLDS snapshot, current household ID mismatch, unexpired bulk lease, and unauthorized roles.
- [ ] `restoreHouseholdCheckpointCallable` keeps request shape `{ lessonRunId, checkpointId, reason, idempotencyKey }`; require non-empty trimmed reason.
- [ ] Authorization happens before checkpoint/subordinate reads.
- [ ] Only PRIMARY/ASSISTANT may restore.
- [ ] Compare sorted current authoritative team/household IDs to sorted snapshot householdIds exactly.

### Step 6.3 — Create PRE_RESTORE exactly once

- [ ] Add failing retry test proving the pre-restore checkpoint is reused.
- [ ] Derive key `pre-restore:${idempotencyDocumentId(lessonRunId, idempotencyKey)}`.
- [ ] Create complete v2 checkpoint from current state before the restore transaction.
- [ ] Store its ID in the restore idempotency record.

### Step 6.4 — Restore Firestore atomically

- [ ] Add transaction test that injects a failure and proves no subset of HouseholdState docs is committed.
- [ ] In one transaction, perform all reads first:
  - restore idempotency record;
  - LessonRun;
  - target checkpoint;
  - all current HouseholdState docs;
  - event idempotency/counter reads through `appendLessonEventInTransaction`.
- [ ] Validate snapshot again inside transaction.
- [ ] Increment `restoreGeneration` exactly once.
- [ ] Write all snapshot HouseholdState docs.
- [ ] Append `CHECKPOINT_RESTORED` event with `{ checkpointId, reason, newRestoreGeneration }`.
- [ ] Write `HouseholdRestoreIdempotencyRecord` with `projectionStatus='PENDING'`.
- [ ] Do not call the old generic restore first and then overwrite households in a second transaction.

### Step 6.5 — Restore RTDB safe projection and clear stale private logs

- [ ] Add failing tests for RTDB failure after Firestore commit, same-request retry, and retry after a newer restore generation.
- [ ] After Firestore commit, use one RTDB root `update()` map to:
  - restore each `lessonRunTeamState/{lessonRunId}/{teamId}/household` from snapshot `teamViews`;
  - write/update `orgId` and `updatedAtMillis` on each touched team node;
  - set `lessonRunPrivate/{lessonRunId}/householdComputationLog/{householdId}` to `null` for every restored household.
- [ ] Do not change `lessonRunPublic.economicFactors`.
- [ ] If RTDB update succeeds, mark Firestore idempotency `projectionStatus='SYNCED'`.
- [ ] If retry finds `projectionStatus='PENDING'`, permit only when current `restoreGeneration === newRestoreGeneration`; then retry RTDB sync without rewriting HouseholdState or appending another event.
- [ ] If generation advanced, return `failed-precondition` and do not apply stale team projections.
- [ ] Export/retain `restoreHouseholdCheckpointCallable` from `functions/src/index.ts` under the same callable name.
- [ ] Run `npm --prefix functions test -- src/homeEconomics/householdRestore.test.ts src/homeEconomics/onCall.test.ts src/homeEconomics/householdCheckpoint.test.ts` and verify pass.
- [ ] Run `npm --prefix functions run typecheck`.
- [ ] Commit: `git add functions/src/homeEconomics functions/src/index.ts && git commit -m "feat: make household checkpoint restore atomic"`

---

## Task 7: Add client wrappers and synchronized client types

**Owner:** Antigravity

**Files:**
- Create: `src/lib/homeEconomics/teacherDashboard.ts`
- Create: `src/lib/homeEconomics/teacherDashboard.test.ts`
- Create: `src/lib/homeEconomics/bulkSettlement.ts`
- Create: `src/lib/homeEconomics/bulkSettlement.test.ts`
- Create: `src/lib/homeEconomics/checkpoints.ts`
- Create: `src/lib/homeEconomics/checkpoints.test.ts`
- Modify: `src/lib/homeEconomics/processRound.ts`
- Modify: `src/lib/homeEconomics/processRound.test.ts`

**Consumes:** Tasks 4–6 callable contracts.

**Produces:** thin Firebase Functions wrappers for React UI; no client-side authority logic.

### Step 7.1 — Dashboard wrapper

- [ ] Add failing wrapper test asserting callable name and request payload.
- [ ] Implement synchronized client interfaces from Shared Contracts and:

```ts
export const getHouseholdTeacherDashboard = async (
  functions: Functions,
  lessonRunId: string,
): Promise<HouseholdTeacherDashboard> => {
  const callable = httpsCallable<
    { lessonRunId: string },
    HouseholdTeacherDashboard
  >(functions, 'getHouseholdTeacherDashboardCallable')
  return (await callable({ lessonRunId })).data
}
```

- [ ] No dashboard aggregation, warning inference, hidden-event filtering, or permission logic belongs in this client module.

### Step 7.2 — Bulk wrapper

- [ ] Add failing tests for normal and force payloads.
- [ ] Implement `processHouseholdRoundBatch(functions, input)` calling `processHouseholdRoundBatchCallable`.
- [ ] `idempotencyKey` is generated by UI action ownership, not inside retryable low-level wrapper; wrapper receives it explicitly.

### Step 7.3 — Checkpoint wrappers

- [ ] Add failing tests for manual write and restore.
- [ ] Implement:

```ts
export interface WriteHouseholdCheckpointInput {
  lessonRunId: string
  label: string
  idempotencyKey: string
}

export interface RestoreHouseholdCheckpointInput {
  lessonRunId: string
  checkpointId: string
  reason: string
  idempotencyKey: string
}
```

- [ ] Call `writeHouseholdCheckpointCallable` and `restoreHouseholdCheckpointCallable` respectively.

### Step 7.4 — Update single-round wrapper union

- [ ] Add failing tests for `COMMITTED` and `ALREADY_SETTLED` response decoding.
- [ ] Replace the old client assumption that every successful callable returns a settlement detail object. Mirror Task 1's discriminated `ProcessRoundExecutionResult`.
- [ ] Existing callers that only need success/failure must accept either success status without trying to read `settlement` unconditionally.
- [ ] Run `npm test -- src/lib/homeEconomics/teacherDashboard.test.ts src/lib/homeEconomics/bulkSettlement.test.ts src/lib/homeEconomics/checkpoints.test.ts src/lib/homeEconomics/processRound.test.ts` and verify pass.
- [ ] Run `npm run typecheck`.
- [ ] Commit: `git add src/lib/homeEconomics && git commit -m "feat: add household teacher operation clients"`

---

## Task 8: Build `HouseholdTeacherDashboard` UI

**Owner:** Codex

**Files:**
- Create: `src/components/teacher/HouseholdTeacherDashboard.tsx`
- Create: `src/components/teacher/HouseholdTeacherDashboard.test.tsx`

**Consumes:** Task 7 wrappers, `LessonRunRole`, MUI.

**Produces:** teacher-facing summary/actions/household table/checkpoint history; no route integration yet.

### Step 8.1 — Render read-only dashboard first

- [ ] Add failing component tests for loading, load error, aligned summary, mismatched rounds, warnings, collapsed/expanded household details, VIEWER read-only controls.
- [ ] Run `npm test -- src/components/teacher/HouseholdTeacherDashboard.test.tsx` and verify failure.
- [ ] Implement component props:

```ts
export interface HouseholdTeacherDashboardProps {
  lessonRunId: string
  role: LessonRunRole
  functions: Functions
}
```

- [ ] Load dashboard on mount and expose 「最新状態に更新」.
- [ ] Summary shows current round only when aligned; otherwise show 「家庭ごとに進行位置が異なります」.
- [ ] Compact table columns: チーム / ラウンド / 提出 / 決算 / 現金 / 資産 / 借入 / 警告.
- [ ] Expanded row shows life stage, asset breakdown, insurance, liabilities, last income/expenses/net cashflow/shortfall, goal delay, revealed events and latest settlement status.

### Step 8.2 — Implement role-aware settlement controls

- [ ] Add failing tests: ASSISTANT/VIEWER cannot settle; PRIMARY normal bulk enabled only aligned+all submitted; force button appears only PRIMARY; force confirmation lists missing teams.
- [ ] Normal bulk action owns one idempotency key per user click. Disable duplicate click while pending.
- [ ] Force dialog must not reuse the normal action silently; its final confirm creates its own key and sends `forceUnsubmitted=true`.
- [ ] If `activeBulkOperation` is RUNNING/PENDING with active server processing, disable individual settlement, manual checkpoint and restore controls and display operation status.
- [ ] On FAILED operation, show item-level failures and a 「失敗した家庭を再試行」 action that reuses the same operation idempotency key retained by UI state for that operation. If the page was reloaded, server dashboard must include enough safe operation identity/retry token mapping for the wrapper to retry; do not invent a new key for the same failed operation.

**Implementation note:** because the design's public operation view does not expose the raw client idempotency key, Task 5 must return a server-generated opaque `retryToken` or `operationId`-based retry contract that does not reveal the original key. Prefer adding a dedicated retry request `{ lessonRunId, operationId }` handled server-side over returning the original idempotency key. Keep the create request contract unchanged. Add this retry contract to Task 5 before Task 8 if needed.

- [ ] Individual settle is normal-only (`forceSettle` not surfaced). It may be used to catch up one submitted household when class rounds differ, but must be disabled during an active bulk lease.
- [ ] After every successful mutation/retry, reload the dashboard.

### Step 8.3 — Implement checkpoint controls

- [ ] Add failing tests for PRIMARY/ASSISTANT manual save, required 1–80 char label, history display, restore reason, restore confirmation text, VIEWER no actions.
- [ ] Manual save dialog sends a fresh idempotency key once on confirm.
- [ ] Restore dialog shows checkpoint label/round and explicitly says current state will be saved first. Require a non-empty reason before confirm.
- [ ] Reload dashboard after save/restore.
- [ ] Run `npm test -- src/components/teacher/HouseholdTeacherDashboard.test.tsx` and verify pass.
- [ ] Run `npm run typecheck`.
- [ ] Commit: `git add src/components/teacher/HouseholdTeacherDashboard* && git commit -m "feat: add household teacher dashboard ui"`

---

## Task 9: Integrate dashboard into `LessonControlRoom` with subject/course-format gating

**Owner:** Claude

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Consumes:** Task 8 component; top-level LessonRun `subject` and `templateSnapshot.homeEconomics.courseFormat` already read by the teacher route guard.

**Produces:** one teacher control route; social studies never calls household API; unsupported home-economics formats show notice only.

### Step 9.1 — Extend route access data without another Firestore read

- [ ] Add failing `App.test.tsx` cases proving teacher route extracts subject/course format from the same LessonRun document used for role resolution.
- [ ] Extend local access state:

```ts
interface TeacherAccess {
  status: AccessStatus
  role?: LessonRunRole
  subject?: LessonSubject
  homeEconomicsCourseFormat?: string
}
```

- [ ] On existing `getDoc(lessonRuns/{runId})`, read top-level `subject` and `templateSnapshot.homeEconomics.courseFormat`; do not add a second route-level Firestore read.
- [ ] Pass these values to `LessonControlRoom`.

### Step 9.2 — Gate rendering inside control room

- [ ] Add failing tests:
  - SOCIAL_STUDIES renders existing control room and no household dashboard;
  - HOME_ECONOMICS + COMMON_CONDITIONS renders dashboard;
  - HOME_ECONOMICS + another format renders explicit unsupported-format notice and no dashboard;
  - all existing phase/participant/intervention controls remain rendered.
- [ ] Extend props:

```ts
export interface LessonControlRoomProps {
  lessonRunId: string
  role: LessonRunRole
  subject: LessonSubject
  homeEconomicsCourseFormat?: string
  functions: Functions
  firestore: Firestore
  database: Database
  phaseGraph?: PhaseNode[]
  onStartLesson?: () => Promise<void> | void
  onAdvancePhase?: (phaseId: string) => Promise<void> | void
}
```

- [ ] Render `HouseholdTeacherDashboard` only when `subject === 'HOME_ECONOMICS' && homeEconomicsCourseFormat === 'COMMON_CONDITIONS'`.
- [ ] For unsupported HOME_ECONOMICS, render a concise notice; no settlement/checkpoint buttons.
- [ ] Do not change `/teacher/lessons/:runId/control` route path.
- [ ] Run `npm test -- src/App.test.tsx src/components/teacher/LessonControlRoom.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx` and verify pass.
- [ ] Run `npm run typecheck`.
- [ ] Commit: `git add src/App.tsx src/App.test.tsx src/components/teacher && git commit -m "feat: integrate household dashboard into control room"`

---

## Task 10: Lock down Rules, acceptance coverage, backlog state, and verify the whole repository

**Owner:** Codex

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`
- Modify: `test/household-lifecycle.acceptance.test.ts`
- Modify: `docs/superpowers/scope-backlog.md`

**Consumes:** all prior tasks.

**Produces:** explicit client denial for new server-only operation/idempotency paths; end-to-end household teacher workflow regression; updated scope ledger; verified branch.

### Step 10.1 — Make server-only Firestore paths explicit

- [ ] Add failing Emulator tests proving a signed-in teacher cannot directly read/write:
  - `householdBulkSettlementOperations/{operationId}`;
  - `lessonRuns/{lessonRunId}/householdCheckpointRestoreIdempotency/{key}`.
- [ ] Run `npm run test:rules` and verify the new expectations fail before explicit rule entries are added.
- [ ] Add explicit deny rules even though the final catch-all already denies them, so the security intent is reviewable next to other server-internal records.

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

- [ ] Re-run `npm run test:rules` and verify pass.

### Step 10.2 — Extend household lifecycle acceptance test

- [ ] Add acceptance coverage for the server-level sequence using dependency-injected/pure layers already introduced:
  1. COMMON_CONDITIONS teams exist;
  2. dashboard lists uninitialized teams without mutating them;
  3. normal bulk rejects missing decisions;
  4. force bulk creates one PRE_SETTLEMENT checkpoint and settles all;
  5. retry does not double-settle;
  6. manual checkpoint v2 is listed;
  7. restore creates PRE_RESTORE checkpoint, restores all HouseholdState docs, and re-syncs safe team views;
  8. stale private computation logs are removed;
  9. decision history remains.
- [ ] Run `npm test -- test/household-lifecycle.acceptance.test.ts` and verify pass.

### Step 10.3 — Update the scope ledger only after implementation is green

- [ ] Re-read `docs/superpowers/scope-backlog.md` immediately before editing it.
- [ ] Update Phase 4 to state the COMMON_CONDITIONS teacher operation dashboard is implemented: overview, individual/bulk/explicit-force settlement, checkpoint v2, atomic restore, Control Room integration.
- [ ] Keep advanced lesson formats (`ROLE_VARIANT`, `STAGE_SPLIT`, `MULTI_PERSON_PER_TEAM`) listed as remaining work.
- [ ] Do not mark unrelated client visualization/evaluation work complete unless the implementation actually covers it.

### Step 10.4 — Full verification

- [ ] Run functions-focused verification:

```bash
npm --prefix functions run verify
```

Expected: functions lint/typecheck/tests/build all pass.

- [ ] Run root verification:

```bash
npm run verify
```

Expected: root lint/typecheck/tests/rules/build all pass.

- [ ] If either command fails, fix the implementation or test; do not weaken assertions just to make verification green.
- [ ] Run `git status --short` and confirm only intended files remain modified.
- [ ] Commit final rules/acceptance/backlog work:

```bash
git add firestore.rules test/firestore.rules.test.ts test/household-lifecycle.acceptance.test.ts docs/superpowers/scope-backlog.md
git commit -m "test: verify household teacher dashboard workflow"
```

- [ ] Re-run both verification commands after the final commit.
- [ ] Confirm branch HEAD and working tree:

```bash
git status --short
git log -1 --oneline
```

- [ ] Push the completed implementation:

```bash
git push origin codex/classroom
```

- [ ] Verify the remote `codex/classroom` HEAD matches the local final commit before reporting completion.

---

## Review Checklist

Before accepting implementation, inspect the actual GitHub diff and verify all of the following:

- [ ] Dashboard Callable does not read household/decision/event/checkpoint data before teacher role + active membership authorization.
- [ ] Dashboard response contains no private coefficients, random seed, internal risk/claim probability, or unrevealed future events.
- [ ] SOCIAL_STUDIES Control Room never mounts/calls household dashboard.
- [ ] Unsupported home-economics formats have no settlement/checkpoint controls.
- [ ] Normal bulk settlement performs no household/checkpoint mutation when any current-round decision is missing.
- [ ] Force settlement is explicit and only missing-decision households get `forcedSettlement=true`.
- [ ] Bulk operation same key/same payload replays; same key/different payload rejects.
- [ ] Lease expiry can be resumed safely and SUCCEEDED items are never processed again.
- [ ] A crash between household commit and operation item update is recovered by authoritative roundIndex, not by a second settlement.
- [ ] Individual settlement does not stale-publish RTDB after duplicate CAS.
- [ ] Manual checkpoint/restore and individual settlement reject while a bulk lease is active.
- [ ] v2 checkpoint includes all current household IDs and safe team views, and excludes private logs.
- [ ] v1 checkpoints are not offered by the new restore UI.
- [ ] PRE_SETTLEMENT and PRE_RESTORE checkpoints are idempotent and do not multiply on retry.
- [ ] Restore writes every HouseholdState in one Firestore transaction and increments `restoreGeneration` once.
- [ ] RTDB restore retry cannot overwrite a newer restore generation.
- [ ] Stale `householdComputationLog` entries are cleared on restore while public economic factors remain unchanged.
- [ ] Direct client access to operation/restore-idempotency records is denied.
- [ ] `npm --prefix functions run verify` passes.
- [ ] `npm run verify` passes.
- [ ] Remote `codex/classroom` contains the final implementation commit.
