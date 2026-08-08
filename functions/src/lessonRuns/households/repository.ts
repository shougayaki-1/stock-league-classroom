import { getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest } from '../../lib/idempotency'

export interface HouseholdState {
  householdId: string
  lessonRunId: string
  teamId: string
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
    const state: HouseholdState = {
      householdId: input.householdId, lessonRunId: input.lessonRunId, teamId: input.teamId,
      cashYen: input.startingCashYen, assetHoldingsYen: {}, activeInsuranceContracts: {},
      activeLiabilities: {}, lifeStage: input.startingLifeStage, roundIndex: 0,
      goalDelayedRounds: 0, updatedAtServerMillis: input.now(),
    }
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
  }
  tx.set(`lessonRuns/${input.lessonRunId}/households/${input.householdId}/decisions/${decisionId}`, decision as unknown as Record<string, unknown>)
  tx.set(idempotencyPath, { decisionId, requestDigest: digest })
  return { decisionId, created: true }
})
