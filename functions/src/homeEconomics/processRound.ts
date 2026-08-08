import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { appendLessonEventInTransaction, type FirestoreTx } from '../lessonRuns/appendLessonEvent'
import {
  getHouseholdDecisionForRoundWithAdminSdk,
  getHouseholdStateWithAdminSdk,
  type HouseholdState,
} from '../lessonRuns/households/repository'
import { settleRound, type SettleRoundInput, type SettleRoundResult } from './engine/settleRound'
import type { HouseholdDecisionInput } from './submitDecision'

/**
 * `processRound` is the Admin SDK wrapper around the pure `settleRound`
 * orchestrator (Task 11). It is the entry point `processRoundCallable`
 * (`onCall.ts`) calls once per teacher-triggered round settlement, for one
 * household at a time (mirroring `settleRound`'s own single-household
 * scope).
 *
 * Per this task's scoping note: this file implements Firestore-side I/O
 * only (steps 1-4 below). RTDB `lessonRunPublic`/`lessonRunPrivate`/
 * `lessonRunTeamState` projections (the brief's step 5) are INTENTIONALLY
 * NOT wired here — deferred to Task 15, which has not run yet in this
 * session and whose schema fields this would need do not exist. This
 * mirrors Phase C's own documented RTDB deferral (`processBatch.ts`'s
 * step 8), except this time the deferral is written down explicitly here
 * and in task-11-report.md so it does not go unnoticed the way Phase C's
 * did ("先送りしたまま最終レビューまで気づかれなかった").
 *
 * The four steps below map onto `ProcessRoundDeps`'s methods, in the
 * order `processRound` calls them:
 *
 * 1. readLessonRunConfig — read `lessonRuns/{id}`'s randomSeed/
 *    restoreGeneration/orgId plus the `HomeEconomicsContent` snapshot
 *    (households/assets/insuranceProducts/lifeEvents/liabilities/
 *    publicSupportPrograms/roundYears/economicFactors/borrowingAllowed/
 *    taxAndSocialInsuranceModelVersion) captured at lessonRun creation
 *    time (`createLessonRun.ts`'s `templateSnapshot`), never a live
 *    re-read of the draft template — a lesson already running must not
 *    have its rules change underneath it.
 * 2. readHouseholdState + readHouseholdDecision — Task 10's
 *    `HouseholdState` document and this round's `HouseholdDecisionInput`
 *    (or `null` when the household never submitted — `settleRound`'s own
 *    §13.13 fallback handles that, not this wrapper).
 * 3. settleRoundFn — call the pure orchestrator (Task 11) with the data
 *    from steps 1-2 assembled, including the Step 4 fix: `assetCatalog`
 *    resolved from `HomeEconomicsContent.assets` and forwarded so
 *    `settleRound`'s `computeAssetReturn` calls use real
 *    expectedReturnPercent/volatilityPercent, not a placeholder.
 * 4. commitRoundSettlement — inside a single Firestore transaction (all
 *    reads before all writes, per the Global Constraints transaction
 *    rule): re-read the `HouseholdState` document, guard against a
 *    concurrent/duplicate settlement of the SAME round (compare-and-set
 *    on `roundIndex`, mirroring `processBatch.ts`'s
 *    `lastProcessedBatchId` compare-and-set), append a `ROUND_SETTLED`
 *    `LessonEvent` via Phase A's `appendLessonEventInTransaction`, and
 *    write the updated `HouseholdState`.
 */
export interface ProcessRoundDeps {
  readLessonRunConfig: (lessonRunId: string) => Promise<{
    orgId: string
    randomSeed: string
    restoreGeneration: number
    homeEconomics: HomeEconomicsContent
  }>
  readHouseholdState: (lessonRunId: string, householdId: string) => Promise<HouseholdState | null>
  readHouseholdDecision: (lessonRunId: string, householdId: string, roundIndex: number) => Promise<HouseholdDecisionInput | null>
  settleRoundFn: (input: SettleRoundInput) => SettleRoundResult
  commitRoundSettlement: (input: {
    lessonRunId: string
    householdId: string
    orgId: string
    expectedPriorRoundIndex: number
    result: SettleRoundResult
    actorId: string
  }) => Promise<void>
}

export interface ProcessRoundInput {
  lessonRunId: string
  householdId: string
  /** The teacher uid that triggered this settlement — recorded on the `ROUND_SETTLED` LessonEvent. */
  actorId: string
}

export const processRound = async (deps: ProcessRoundDeps, input: ProcessRoundInput): Promise<SettleRoundResult> => {
  const [config, household] = await Promise.all([
    deps.readLessonRunConfig(input.lessonRunId),
    deps.readHouseholdState(input.lessonRunId, input.householdId),
  ])
  if (!household) throw new Error('HouseholdState not found')

  const profile = config.homeEconomics.households.find((p) => p.householdId === input.householdId)
  if (!profile) throw new Error('HouseholdProfile not found in template snapshot')

  const decision = await deps.readHouseholdDecision(input.lessonRunId, input.householdId, household.roundIndex)

  const result = deps.settleRoundFn({
    household,
    profile,
    decision,
    lifeEvents: config.homeEconomics.lifeEvents,
    insuranceProducts: config.homeEconomics.insuranceProducts,
    publicSupportPrograms: config.homeEconomics.publicSupportPrograms,
    liabilityCatalog: config.homeEconomics.liabilities,
    assetCatalog: config.homeEconomics.assets,
    economicFactors: config.homeEconomics.economicFactors,
    taxModelVersion: config.homeEconomics.taxAndSocialInsuranceModelVersion,
    roundYears: config.homeEconomics.roundYears,
    borrowingAllowed: config.homeEconomics.borrowingAllowed,
    randomSeed: config.randomSeed,
    restoreGeneration: config.restoreGeneration,
  })

  await deps.commitRoundSettlement({
    lessonRunId: input.lessonRunId,
    householdId: input.householdId,
    orgId: config.orgId,
    expectedPriorRoundIndex: household.roundIndex,
    result,
    actorId: input.actorId,
  })

  // TODO(Task 15): RTDB lessonRunPublic/lessonRunPrivate/lessonRunTeamState
  // projections for this round settlement are NOT written here — see this
  // file's doc comment. Task 15 must wire these before students can see a
  // round's outcome via the realtime projections.

  return result
}

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

const readLessonRunConfigWithAdminSdk: ProcessRoundDeps['readLessonRunConfig'] = async (lessonRunId) => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  if (!snap.exists) throw new Error('LessonRun not found')
  const data = snap.data() as {
    orgId?: string
    randomSeed?: string
    restoreGeneration?: number
    templateSnapshot?: { homeEconomics?: HomeEconomicsContent }
  }
  if (!data.templateSnapshot?.homeEconomics) throw new Error('LessonRun has no homeEconomics content')
  return {
    orgId: data.orgId ?? '',
    randomSeed: data.randomSeed ?? '',
    restoreGeneration: data.restoreGeneration ?? 0,
    homeEconomics: data.templateSnapshot.homeEconomics,
  }
}

const readHouseholdDecisionWithAdminSdk: ProcessRoundDeps['readHouseholdDecision'] = async (lessonRunId, householdId, roundIndex) => {
  const record = await getHouseholdDecisionForRoundWithAdminSdk(lessonRunId, householdId, roundIndex)
  if (!record) return null
  return {
    lessonRunId,
    householdId,
    roundIndex: record.roundIndex,
    assetAllocationChangesYen: record.assetAllocationChangesYen,
    insurancePurchaseIds: record.insurancePurchaseIds,
    insuranceCancelIds: record.insuranceCancelIds,
    shortfallResolutionType: record.shortfallResolutionType,
    ...(record.shortfallResolutionAssetType !== undefined ? { shortfallResolutionAssetType: record.shortfallResolutionAssetType } : {}),
    publicSupportApplicationIds: record.publicSupportApplicationIds,
    idempotencyKey: record.idempotencyKey,
  }
}

/**
 * Commits the settled `HouseholdState` and appends a `ROUND_SETTLED`
 * `LessonEvent`, inside a single Firestore transaction, ALL reads before
 * ALL writes:
 *
 * 1. Re-read the household doc (fresh, inside this transaction). If its
 *    `roundIndex` no longer equals `expectedPriorRoundIndex` — i.e. this
 *    round was already settled by a concurrent/duplicate call — this is a
 *    no-op, not an error, mirroring `processBatch.ts`'s
 *    `lastProcessedBatchId` compare-and-set guard against double
 *    settlement.
 * 2. `appendLessonEventInTransaction`'s own two reads (idempotency doc,
 *    event counter) happen next — still within the read phase.
 * 3. Then all writes: the event doc, the counter doc, the event
 *    idempotency doc (all three from `appendLessonEventInTransaction`),
 *    and finally the `HouseholdState` doc itself.
 *
 * The event's own idempotencyKey is deterministic
 * (`round-settled_${lessonRunId}_${householdId}_${expectedPriorRoundIndex}`)
 * rather than client-supplied, so a duplicate Callable invocation for the
 * same round naturally dedupes at the event layer too — this task's brief
 * flagged idempotency as not strictly required, but this compare-and-set +
 * deterministic-key combination closes the double-settlement risk without
 * inventing a bespoke mechanism (reusing `appendLessonEvent`'s existing
 * idempotency pattern, per the Global Constraints instruction to prefer
 * `lib/idempotency.ts`'s established pattern over a new one).
 */
const commitRoundSettlementWithAdminSdk: ProcessRoundDeps['commitRoundSettlement'] = async (input) => {
  const db = getFirestore()
  await db.runTransaction(async (tx) => {
    const txAdapter: FirestoreTx = {
      get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path, data) => { tx.set(db.doc(path), data) },
    }

    // ---- ALL READS FIRST ----
    const householdPath = `lessonRuns/${input.lessonRunId}/households/${input.householdId}`
    const householdSnap = await txAdapter.get(householdPath)
    if (!householdSnap.exists) return
    const currentHousehold = householdSnap.data() as unknown as HouseholdState
    if (currentHousehold.roundIndex !== input.expectedPriorRoundIndex) return // already settled — no-op guard

    const idempotencyKey = `round-settled_${input.lessonRunId}_${input.householdId}_${input.expectedPriorRoundIndex}`
    await appendLessonEventInTransaction(txAdapter, {
      lessonRunId: input.lessonRunId,
      orgId: input.orgId,
      type: 'ROUND_SETTLED',
      actorType: 'TEACHER',
      actorId: input.actorId,
      payload: {
        householdId: input.householdId,
        roundIndex: input.expectedPriorRoundIndex,
        occurredEventIds: input.result.occurredEventIds,
        incomeYen: input.result.incomeYen,
        expensesYen: input.result.expensesYen,
        netCashFlowYen: input.result.netCashFlowYen,
        shortfallYen: input.result.shortfallYen,
        insuranceBenefitsYen: input.result.insuranceBenefitsYen,
      },
      idempotencyKey,
    }, Date.now())

    // ---- WRITE AFTER (household state) ----
    txAdapter.set(householdPath, input.result.newHouseholdState as unknown as Record<string, unknown>)
  })
}

export const processRoundDepsWithAdminSdk = (): ProcessRoundDeps => ({
  readLessonRunConfig: readLessonRunConfigWithAdminSdk,
  readHouseholdState: getHouseholdStateWithAdminSdk,
  readHouseholdDecision: readHouseholdDecisionWithAdminSdk,
  settleRoundFn: settleRound,
  commitRoundSettlement: commitRoundSettlementWithAdminSdk,
})

export const processRoundWithAdminSdk = (input: ProcessRoundInput): Promise<SettleRoundResult> =>
  processRound(processRoundDepsWithAdminSdk(), input)
