import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../../lib/idempotency'

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
