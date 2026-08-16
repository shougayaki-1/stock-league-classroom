import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../../lib/idempotency'
// Type-only import — no runtime dependency, and `statusTransition.ts` does not
// import this module, so this does not introduce an import cycle. This is the
// single Task 3 shape (`lessonRuns/{id}/householdRuntime/control`) that both
// Task 3's bulk-settlement lock and this file's advanced decision-save
// transaction below read/guard against, so its type is shared rather than
// redeclared here.
import type { HouseholdRuntimeControl } from '../../homeEconomics/statusTransition'

export interface HouseholdState {
  householdId: string
  lessonRunId: string
  teamId: string
  /**
   * The authored `HouseholdProfile.householdId` (from the LessonRun's
   * `HomeEconomicsContent.households[]` template snapshot) this runtime
   * household is actually using. Distinct from `householdId` above, which
   * is an opaque per-team-slot RUNTIME identity (`runtimeHouseholdId()`,
   * Task 1) — under COMMON_CONDITIONS the two happen to collide
   * (`householdId === teamId === the sole profile's householdId`), but
   * under the 3 advanced formats they never do: a team's runtime household
   * is a different Firestore doc id than the profile it plays, and the
   * same profile can be assigned to more than one team. This field is
   * always required in business logic — decode possibly-missing legacy
   * persistence through `StoredHouseholdState`/`resolveStoredHouseholdState`
   * below, never by loosening this field itself.
   */
  profileId: string
  cashYen: number
  /** assetType → current value. Mirrors Task 1's AssetType keys. */
  assetHoldingsYen: Record<string, number>
  /** insuranceProductId → contract years remaining. Absence = not contracted. */
  activeInsuranceContracts: Record<string, number>
  /** liabilityId → remaining principal/term. `annualInterestRatePercent` is fixed at origination (from Task 1's `Liability` catalog) and never re-read from the catalog after signing, so a teacher editing the draft mid-lesson cannot retroactively change an already-taken loan's rate. */
  activeLiabilities: Record<string, { remainingPrincipalYen: number; remainingYears: number; annualInterestRatePercent: number }>
  lifeStage: string
  roundIndex: number
  goalDelayedRounds: number
  updatedAtServerMillis: number
}

/**
 * The shape a `HouseholdState` document ACTUALLY has at rest in Firestore —
 * `profileId` is optional here ONLY because documents written before this
 * task's migration exist without it. This type exists solely to decode that
 * possibly-old persistence at the read boundary; it must never leak into
 * business logic (settlement, processRound, projections, ...), which always
 * operates on the fully-resolved `HouseholdState` with `profileId: string`
 * required. Always pass a freshly-read document through
 * `resolveStoredHouseholdState()` before using it as a `HouseholdState`.
 */
export type StoredHouseholdState = Omit<HouseholdState, 'profileId'> & { profileId?: string }

/**
 * Normalizes a possibly-legacy persisted `StoredHouseholdState` into a real
 * `HouseholdState` with a guaranteed-present `profileId`.
 *
 * - Already present: passed through unchanged (a type-narrowing no-op).
 * - Missing AND `content.courseFormat === 'COMMON_CONDITIONS'` with exactly
 *   one authored profile: infers `profileId` as that sole profile's
 *   `householdId` — the same "exactly one profile" invariant
 *   `commonConditionsHousehold.ts`'s `resolveCommonConditionsProfile()`
 *   already relies on for COMMON_CONDITIONS's `householdId === teamId`
 *   lazy-init path. (The logic is intentionally re-expressed here, not
 *   imported from `commonConditionsHousehold.ts`, to avoid a
 *   repository.ts ↔ commonConditionsHousehold.ts import cycle — that file
 *   already imports repository.ts's `buildInitialHouseholdState`/
 *   `getOrInitHouseholdState`.)
 * - Missing under any of the 3 advanced formats (or COMMON_CONDITIONS
 *   without exactly one profile): FAILS CLOSED — there is no safe
 *   inference for a missing `profileId` on an advanced-format household;
 *   record identity there is never positional.
 *
 * This is a READ-TIME-ONLY normalization. It does not persist the inferred
 * value back to Firestore — an optional backfill on the next legitimate
 * write is permitted, but not required by this function.
 */
export const resolveStoredHouseholdState = (input: {
  stored: StoredHouseholdState
  content: HomeEconomicsContent
}): HouseholdState => {
  if (input.stored.profileId !== undefined) return input.stored as HouseholdState

  if (input.content.courseFormat === 'COMMON_CONDITIONS' && input.content.households.length === 1) {
    return { ...input.stored, profileId: input.content.households[0].householdId }
  }

  throw new Error(
    `HouseholdState (householdId=${input.stored.householdId}, lessonRunId=${input.stored.lessonRunId}) is missing profileId and it cannot be safely inferred for courseFormat ${input.content.courseFormat}. This indicates a data-integrity problem — an advanced-format household must always have its profileId recorded at initialization time.`,
  )
}

export interface BuildInitialHouseholdStateInput {
  lessonRunId: string
  teamId: string
  householdId: string
  profileId: string
  startingCashYen: number
  startingLifeStage: string
  nowMillis: number
}

export const buildInitialHouseholdState = (input: BuildInitialHouseholdStateInput): HouseholdState => ({
  householdId: input.householdId,
  lessonRunId: input.lessonRunId,
  teamId: input.teamId,
  profileId: input.profileId,
  cashYen: input.startingCashYen,
  assetHoldingsYen: {},
  activeInsuranceContracts: {},
  activeLiabilities: {},
  lifeStage: input.startingLifeStage,
  roundIndex: 0,
  goalDelayedRounds: 0,
  updatedAtServerMillis: input.nowMillis,
})

export interface HouseholdFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: HouseholdTx) => Promise<T>) => Promise<T> }
}
export interface HouseholdTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface GetOrInitHouseholdStateInput extends HouseholdFirestoreDeps {
  lessonRunId: string
  teamId: string
  householdId: string
  profileId: string
  startingCashYen: number
  startingLifeStage: string
  now: () => number
}

export const getOrInitHouseholdState = (input: GetOrInitHouseholdStateInput): Promise<HouseholdState> =>
  input.firestore.runTransaction(async (tx) => {
    const path = `lessonRuns/${input.lessonRunId}/households/${input.householdId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(path)
    if (existing.exists) return existing.data() as unknown as HouseholdState

    // ---- ALL WRITES AFTER ----
    const state = buildInitialHouseholdState({
      lessonRunId: input.lessonRunId,
      teamId: input.teamId,
      householdId: input.householdId,
      profileId: input.profileId,
      startingCashYen: input.startingCashYen,
      startingLifeStage: input.startingLifeStage,
      nowMillis: input.now(),
    })
    tx.set(path, state as unknown as Record<string, unknown>)
    return state
  })

/** Production wiring: Firestore Admin SDK. */
export const householdRepositoryWithAdminSdk = (): HouseholdFirestoreDeps['firestore'] => {
  const db = getFirestore()
  return {
    runTransaction: (fn) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

/**
 * Read-only lookup used by `submitHouseholdDecisionCallable` to resolve the
 * `teamId` actually responsible for a `householdId` BEFORE authorizing the
 * caller — same "read the entity first, authorize against its own stored
 * owner field, never trust a client-supplied ownership claim" shape as
 * `cancelOrderCallable`'s `getOrder`-then-`requireTeamMembership` sequence
 * (`market/onCall.ts`). Outside any transaction: it is a plain
 * point-lookup, not part of `saveHouseholdDecision`'s read-then-write
 * transaction below.
 */
export const getHouseholdStateWithAdminSdk = async (
  lessonRunId: string, householdId: string,
): Promise<HouseholdState | null> => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}/households/${householdId}`).get()
  if (!snap.exists) return null
  return snap.data() as unknown as HouseholdState
}

/**
 * Read-only lookup used by `processRound`'s Admin SDK wrapper (Task 11) to
 * find the round's submitted decision, if any — `decisionId` is a hashed
 * idempotency id (see `saveHouseholdDecision`), so it cannot be derived
 * from `(lessonRunId, householdId, roundIndex)` alone; this queries the
 * `decisions` subcollection by `roundIndex` instead. Returns `null` when
 * the household hasn't submitted for this round — `settleRound`'s
 * §13.13 fallback (`REDUCE_EXPENSES`) handles that case, this repository
 * function does not synthesize a default. If more than one decision
 * record exists for the same round (a student resubmitting with a
 * different idempotencyKey — not idempotent across different keys), the
 * most recently submitted one wins.
 */
export const getHouseholdDecisionForRoundWithAdminSdk = async (
  lessonRunId: string, householdId: string, roundIndex: number,
): Promise<HouseholdDecisionRecord | null> => {
  const snap = await getFirestore()
    .collection(`lessonRuns/${lessonRunId}/households/${householdId}/decisions`)
    .where('roundIndex', '==', roundIndex)
    .get()
  if (snap.empty) return null
  const records = snap.docs.map((doc) => doc.data() as unknown as HouseholdDecisionRecord)
  records.sort((a, b) => b.submittedAtServerMillis - a.submittedAtServerMillis)
  return records[0]
}

export interface HouseholdDecisionRecord {
  decisionId: string
  lessonRunId: string
  householdId: string
  roundIndex: number
  assetAllocationChangesYen: Record<string, number>
  insurancePurchaseIds: string[]
  insuranceCancelIds: string[]
  shortfallResolutionType: 'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL' | null
  shortfallResolutionAssetType?: string
  publicSupportApplicationIds: string[]
  idempotencyKey: string
  submittedAtServerMillis: number
  /** Spec §13.14 — see `HouseholdDecisionInput`'s own doc comment (`submitDecision.ts`). */
  voluntaryDrawdownRequestedYen?: number
}

export interface SaveHouseholdDecisionInput extends HouseholdFirestoreDeps {
  lessonRunId: string
  householdId: string
  roundIndex: number
  assetAllocationChangesYen: Record<string, number>
  insurancePurchaseIds: string[]
  insuranceCancelIds: string[]
  shortfallResolutionType: 'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL' | null
  shortfallResolutionAssetType?: string
  publicSupportApplicationIds: string[]
  idempotencyKey: string
  now: () => number
  voluntaryDrawdownRequestedYen?: number
}

/**
 * Idempotent per (lessonRunId, householdId, roundIndex, idempotencyKey) —
 * same `idempotencyDocumentId`/`requestDigest` pattern as Task 5's
 * `createPendingOrder` (`lessonRuns/orders/repository.ts`): a lookup
 * document at a hashed path records which decisionId a given key already
 * produced, and a stored request digest rejects the same key being
 * replayed with materially different decision fields rather than silently
 * deduplicating a different submission. All reads happen before all
 * writes, per this repo's Firestore transaction rule.
 */
export const saveHouseholdDecision = (
  input: SaveHouseholdDecisionInput,
): Promise<{ decisionId: string; created: boolean }> => input.firestore.runTransaction(async (tx) => {
  const idempotencyId = idempotencyDocumentId(
    `${input.lessonRunId}/${input.householdId}/${input.roundIndex}`, input.idempotencyKey,
  )
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/households/${input.householdId}/decisionIdempotency/${idempotencyId}`
  const digest = requestDigest({
    roundIndex: input.roundIndex,
    assetAllocationChangesYen: input.assetAllocationChangesYen,
    insurancePurchaseIds: input.insurancePurchaseIds,
    insuranceCancelIds: input.insuranceCancelIds,
    shortfallResolutionType: input.shortfallResolutionType,
    shortfallResolutionAssetType: input.shortfallResolutionAssetType ?? null,
    publicSupportApplicationIds: input.publicSupportApplicationIds,
    voluntaryDrawdownRequestedYen: input.voluntaryDrawdownRequestedYen ?? null,
  })

  // ---- ALL READS FIRST ----
  const existing = await tx.get(idempotencyPath)
  if (existing.exists) {
    const prior = existing.data() as { decisionId: string; requestDigest: string }
    if (prior.requestDigest !== digest) throw new Error('Idempotency key payload mismatch')
    return { decisionId: prior.decisionId, created: false }
  }

  // ---- ALL WRITES AFTER ----
  const decisionId = `${input.lessonRunId}_decision_${idempotencyId}`
  const decision: HouseholdDecisionRecord = {
    decisionId,
    lessonRunId: input.lessonRunId,
    householdId: input.householdId,
    roundIndex: input.roundIndex,
    assetAllocationChangesYen: input.assetAllocationChangesYen,
    insurancePurchaseIds: input.insurancePurchaseIds,
    insuranceCancelIds: input.insuranceCancelIds,
    shortfallResolutionType: input.shortfallResolutionType,
    ...(input.shortfallResolutionAssetType !== undefined ? { shortfallResolutionAssetType: input.shortfallResolutionAssetType } : {}),
    publicSupportApplicationIds: input.publicSupportApplicationIds,
    idempotencyKey: input.idempotencyKey,
    submittedAtServerMillis: input.now(),
    ...(input.voluntaryDrawdownRequestedYen !== undefined ? { voluntaryDrawdownRequestedYen: input.voluntaryDrawdownRequestedYen } : {}),
  }
  tx.set(`lessonRuns/${input.lessonRunId}/households/${input.householdId}/decisions/${decisionId}`, decision as unknown as Record<string, unknown>)
  tx.set(idempotencyPath, { decisionId, requestDigest: digest })
  return { decisionId, created: true }
})

/**
 * Read-only lookup for the Task 3 `HouseholdRuntimeControl` doc
 * (`lessonRuns/{lessonRunId}/householdRuntime/control`) — used by
 * `submitHouseholdDecisionCallable`'s advanced-format branch (Task 5) to
 * capture the control document's CURRENT `assignmentRevision` outside any
 * transaction, before calling `saveAdvancedHouseholdDecisionWithAdminSdk`,
 * which re-reads and re-verifies this document fresh INSIDE its own
 * transaction. `null` when the document does not exist (e.g. a
 * COMMON_CONDITIONS lessonRun, or an advanced lessonRun that has not yet
 * completed its first RUNNING transition/freeze — see `statusTransition.ts`).
 */
export const getHouseholdRuntimeControlWithAdminSdk = async (
  lessonRunId: string,
): Promise<HouseholdRuntimeControl | null> => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}/householdRuntime/control`).get()
  if (!snap.exists) return null
  return snap.data() as unknown as HouseholdRuntimeControl
}

export interface SaveAdvancedHouseholdDecisionInput extends HouseholdFirestoreDeps {
  lessonRunId: string
  householdId: string
  /**
   * The fully-assembled decision record minus `submittedAtServerMillis`
   * (stamped by this function from `nowMillis` below) — including
   * `decisionId`, computed by the caller with the SAME
   * `idempotencyDocumentId`/prefix scheme `saveHouseholdDecision` above uses
   * internally, so decision ids stay in the same format across the Common
   * and advanced save paths. This function trusts and persists
   * `decision.decisionId` as-is; it does not recompute or validate it
   * against `idempotencyKey`.
   */
  decision: Omit<HouseholdDecisionRecord, 'submittedAtServerMillis'>
  /**
   * The round the CALLER believes the household is currently on — checked
   * against BOTH the household's own `roundIndex` and the shared
   * `HouseholdRuntimeControl.synchronizedRoundIndex` (Task 3) before any
   * write, so a decision can never be saved for a round the household has
   * already moved past/not yet reached, or while the household's own
   * `roundIndex` has (for any reason) drifted out of sync with the shared
   * control document.
   */
  expectedSynchronizedRoundIndex: number
  /**
   * The `HouseholdRuntimeControl.assignmentRevision` the caller observed
   * when it decided to submit — re-verified against the control document's
   * CURRENT value inside this transaction, guarding against the assignment
   * having changed between the caller's outer read and this write.
   */
  assignmentRevision: number
  idempotencyKey: string
  nowMillis: number
}

/**
 * Advanced-format (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM)
 * counterpart to `saveHouseholdDecision` above — same idempotency-replay/
 * payload-mismatch discipline (a lookup doc at a hashed
 * `(lessonRunId, householdId, roundIndex, idempotencyKey)` path, ALL READS
 * BEFORE ANY WRITE), but additionally guarded by the shared
 * `HouseholdRuntimeControl` document (Task 3) that Task 6's bulk settlement
 * will also read/lock: a decision may only be saved while
 * `roundStatus === 'OPEN'` (never `'SETTLING'`, which would race with a bulk
 * settlement's read of "who has/hasn't decided yet"), for the SAME
 * `assignmentRevision` the caller observed, and only when the household's own
 * `roundIndex`, the control document's `synchronizedRoundIndex`, and the
 * caller's `expectedSynchronizedRoundIndex` all agree — not just any two of
 * the three.
 *
 * This function reads the idempotency record FIRST and returns immediately
 * on a replay (matching payload) WITHOUT re-checking `roundStatus`/
 * `assignmentRevision`/round consistency — a successful prior submission
 * must remain retriable even after the round has since moved on, exactly
 * like `saveHouseholdDecision`'s own idempotency-replay short-circuit above.
 * The full `HouseholdDecisionRecord` (not just `{ decisionId, requestDigest
 * }`) is persisted in the idempotency doc itself so a replay can return it
 * without an extra read — the same "store the full result in the
 * idempotency doc" shape `prepareHouseholdAssignment`
 * (`householdAssignmentRepository.ts`) already uses for a multi-field
 * result, rather than `saveHouseholdDecision`'s narrower `{ decisionId,
 * created }` return (this function's return type carries no `created` flag
 * at all, so there is nothing narrower to reuse).
 */
export const saveAdvancedHouseholdDecisionWithAdminSdk = (
  input: SaveAdvancedHouseholdDecisionInput,
): Promise<HouseholdDecisionRecord> => input.firestore.runTransaction(async (tx) => {
  const controlPath = `lessonRuns/${input.lessonRunId}/householdRuntime/control`
  const householdPath = `lessonRuns/${input.lessonRunId}/households/${input.householdId}`
  const idempotencyId = idempotencyDocumentId(
    `${input.lessonRunId}/${input.householdId}/${input.decision.roundIndex}`, input.idempotencyKey,
  )
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/households/${input.householdId}/decisionIdempotency/${idempotencyId}`
  const digest = requestDigest({
    roundIndex: input.decision.roundIndex,
    assetAllocationChangesYen: input.decision.assetAllocationChangesYen,
    insurancePurchaseIds: input.decision.insurancePurchaseIds,
    insuranceCancelIds: input.decision.insuranceCancelIds,
    shortfallResolutionType: input.decision.shortfallResolutionType,
    shortfallResolutionAssetType: input.decision.shortfallResolutionAssetType ?? null,
    publicSupportApplicationIds: input.decision.publicSupportApplicationIds,
    voluntaryDrawdownRequestedYen: input.decision.voluntaryDrawdownRequestedYen ?? null,
  })

  // ---- ALL READS FIRST ----
  const existingIdempotency = await tx.get(idempotencyPath)
  if (existingIdempotency.exists) {
    const prior = existingIdempotency.data() as { requestDigest: string; record: HouseholdDecisionRecord }
    if (prior.requestDigest !== digest) throw new Error('Idempotency key payload mismatch')
    return prior.record
  }

  const controlSnap = await tx.get(controlPath)
  if (!controlSnap.exists) throw new Error('HouseholdRuntimeControl not found')
  const control = controlSnap.data() as unknown as HouseholdRuntimeControl

  const householdSnap = await tx.get(householdPath)
  if (!householdSnap.exists) throw new Error('HouseholdState not found')
  const household = householdSnap.data() as unknown as HouseholdState

  // ---- Guard checks (still before any write) ----
  if (control.roundStatus !== 'OPEN') {
    throw new Error('HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)')
  }
  if (control.assignmentRevision !== input.assignmentRevision) {
    throw new Error('HouseholdRuntimeControl assignmentRevision does not match the expected assignment revision')
  }
  if (household.roundIndex !== control.synchronizedRoundIndex) {
    throw new Error('HouseholdState roundIndex does not match HouseholdRuntimeControl synchronizedRoundIndex')
  }
  if (control.synchronizedRoundIndex !== input.expectedSynchronizedRoundIndex) {
    throw new Error('Requested round no longer matches the synchronized round')
  }

  // ---- ALL WRITES AFTER ----
  const record: HouseholdDecisionRecord = { ...input.decision, submittedAtServerMillis: input.nowMillis }
  tx.set(
    `lessonRuns/${input.lessonRunId}/households/${input.householdId}/decisions/${record.decisionId}`,
    record as unknown as Record<string, unknown>,
  )
  tx.set(idempotencyPath, { requestDigest: digest, record })
  return record
})
