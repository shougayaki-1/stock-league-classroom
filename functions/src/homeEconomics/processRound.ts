import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type { HomeEconomicsContent, HouseholdProfile } from '@stock-league/household-authoring-content'
import { appendLessonEventInTransaction, type FirestoreTx } from '../lessonRuns/appendLessonEvent'
import {
  getHouseholdDecisionForRoundWithAdminSdk,
  getHouseholdStateWithAdminSdk,
  resolveStoredHouseholdState,
  type HouseholdState,
  type StoredHouseholdState,
} from '../lessonRuns/households/repository'
import { settleRound, type SettleRoundInput, type SettleRoundResult } from './engine/settleRound'
import { buildEventDisclosureView } from './engine/lifeEvents'
import { resolveVisibleConcepts } from './goalPackage'
import { toAdvancedHouseholdTeamEntryView, toHouseholdStateTeamView } from './realtimeProjection'
import type { HouseholdDecisionInput } from './submitDecision'
import type { HouseholdRuntimeControl } from './statusTransition'

/**
 * `processRound` is the Admin SDK wrapper around the pure `settleRound`
 * orchestrator (Task 11). It is the entry point `processRoundCallable`
 * (`onCall.ts`) calls once per teacher-triggered round settlement, for one
 * household at a time (mirroring `settleRound`'s own single-household
 * scope).
 *
 * This file implements Firestore-side I/O (steps 1-4 below) AND the RTDB
 * `lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState` broadcast (step
 * 5, Task 15). Task 11 deliberately deferred step 5 — see task-11-report.md
 * — mirroring Phase C's own documented RTDB deferral
 * (`market/processBatch.ts`'s step 8 at the time). That Phase C deferral
 * was left as a no-op stub that went unnoticed until the final whole-branch
 * review; Task 15's brief calls this out by name and requires the deferral
 * to end here, not be pushed further. `publishRealtimeState` below is a
 * real Admin SDK implementation, not a stub.
 *
 * The five steps below map onto `ProcessRoundDeps`'s methods, in the
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
 * 5. publishRealtimeState — Task 15: broadcast this round's outcome to the
 *    three RTDB projections `lessonRunPublic`/`lessonRunPrivate`/
 *    `lessonRunTeamState` (database.rules.json). Called AFTER
 *    `commitRoundSettlement`'s Firestore transaction has committed, so
 *    every value broadcast reflects this round's final, committed state.
 *    See `publishRealtimeStateWithAdminSdk`'s own doc comment below for
 *    the field-ownership discipline (allow-list only, `orgId` on every
 *    write, public/private/team-state separation).
 */
export type CommitRoundSettlementResult =
  | { status: 'COMMITTED' }
  | { status: 'ALREADY_SETTLED'; householdState: HouseholdState }

export type ProcessRoundExecutionResult =
  | { status: 'COMMITTED'; settlement: SettleRoundResult }
  | { status: 'ALREADY_SETTLED'; householdState: HouseholdState }

export interface ProcessRoundDeps {
  readLessonRunConfig: (lessonRunId: string) => Promise<{
    orgId: string
    randomSeed: string
    restoreGeneration: number
    homeEconomics: HomeEconomicsContent
  }>
  readHouseholdState: (lessonRunId: string, householdId: string) => Promise<StoredHouseholdState | null>
  readHouseholdDecision: (lessonRunId: string, householdId: string, roundIndex: number) => Promise<HouseholdDecisionInput | null>
  settleRoundFn: (input: SettleRoundInput) => SettleRoundResult
  commitRoundSettlement: (input: {
    lessonRunId: string
    householdId: string
    orgId: string
    expectedPriorRoundIndex: number
    result: SettleRoundResult
    actorId: string
    forcedSettlement: boolean
    /**
     * Task 4 fix (task-4 review finding): the template-snapshot content
     * needed to normalize a possibly-legacy re-read `HouseholdState` via
     * `resolveStoredHouseholdState()` on the `ALREADY_SETTLED` race-guard
     * path below — the SAME `config.homeEconomics` the caller (`processRound`)
     * already normalized its own initial read against, just forwarded so
     * this Admin SDK implementation doesn't need to re-read Firestore for
     * content the caller already has in scope.
     */
    homeEconomicsContent: HomeEconomicsContent
  }) => Promise<CommitRoundSettlementResult>
  /**
   * Task 15: broadcasts this round's settlement to RTDB. Receives every
   * piece `processRound` already has assembled in scope — `orgId` and
   * `homeEconomics` from step 1's config, `profile` (this household's
   * template-snapshot profile, already resolved by `processRound` before
   * calling `settleRoundFn`), the `decision` read in step 2 (or `null` on
   * the `forceSettle` path), and the `result` from `settleRoundFn` — so the
   * Admin SDK implementation never needs to re-read Firestore for data the
   * caller already has, unlike `processBatch.ts`'s equivalent (which only
   * receives `result`/`lessonRunId` and re-reads everything else).
   */
  publishRealtimeState: (input: {
    lessonRunId: string
    orgId: string
    homeEconomics: HomeEconomicsContent
    profile: HouseholdProfile
    decision: HouseholdDecisionInput | null
    result: SettleRoundResult
  }) => Promise<void>
}

export interface ProcessRoundInput {
  lessonRunId: string
  householdId: string
  /** The teacher uid that triggered this settlement — recorded on the `ROUND_SETTLED` LessonEvent. */
  actorId: string
  /**
   * Phase D Task 11 brief §Step 6: `processRoundCallable` is teacher-only
   * and "must only be callable once the whole team has submitted
   * `submitHouseholdDecision`". Since this Callable settles one household
   * at a time, that requirement is enforced per-household here: settling
   * is rejected unless this household has an actual submitted decision on
   * record for the round being settled — UNLESS the teacher explicitly
   * passes `forceSettle: true` (an escape hatch for a household that is
   * unreachable/absent and will never submit).
   *
   * This is intentionally a SEPARATE, earlier safeguard from
   * `settleRound`'s own `decision === null` → `REDUCE_EXPENSES` auto-fallback
   * (§13.13 "never auto-bankrupts"). That fallback exists for a shortfall
   * only discovered *during* settlement despite a decision having been
   * submitted (or for the explicit-force case here) — it was never meant
   * to let a teacher skip the decision phase entirely for a household that
   * simply hasn't had the chance to submit ANY decision yet (asset
   * allocation, insurance changes, etc., not just shortfall resolution).
   * Defaults to `false`/unset — the safe default is to require a decision.
   */
  forceSettle?: boolean
}

export const processRound = async (deps: ProcessRoundDeps, input: ProcessRoundInput): Promise<ProcessRoundExecutionResult> => {
  const [config, storedHousehold] = await Promise.all([
    deps.readLessonRunConfig(input.lessonRunId),
    deps.readHouseholdState(input.lessonRunId, input.householdId),
  ])
  if (!storedHousehold) throw new Error('HouseholdState not found')

  // Task 4: `household.profileId` is the runtime household's unambiguous
  // record of which authored `HouseholdProfile` it is actually using —
  // normalize the possibly-legacy stored document through
  // `resolveStoredHouseholdState()` FIRST (infers `profileId` only for the
  // COMMON_CONDITIONS single-profile case; fails closed for the 3 advanced
  // formats), then resolve the profile by a simple, unambiguous exact
  // match. This replaces the prior courseFormat+array-length positional
  // heuristic, which could never disambiguate two teams running the same
  // profile (MULTI_PERSON_PER_TEAM) or a team's runtime householdId
  // differing from its profile's id (ROLE_VARIANT/STAGE_SPLIT).
  const household = resolveStoredHouseholdState({ stored: storedHousehold, content: config.homeEconomics })
  const profile = config.homeEconomics.households.find((p) => p.householdId === household.profileId)
  if (!profile) throw new Error('HouseholdProfile not found in template snapshot')

  const decision = await deps.readHouseholdDecision(input.lessonRunId, input.householdId, household.roundIndex)

  if (!decision && !input.forceSettle) {
    throw new Error('HouseholdDecision not submitted for this round')
  }

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

  const forcedSettlement = decision === null && input.forceSettle === true

  const commitResult = await deps.commitRoundSettlement({
    lessonRunId: input.lessonRunId,
    householdId: input.householdId,
    orgId: config.orgId,
    expectedPriorRoundIndex: household.roundIndex,
    result,
    actorId: input.actorId,
    forcedSettlement,
    homeEconomicsContent: config.homeEconomics,
  })

  if (commitResult.status === 'ALREADY_SETTLED') {
    return commitResult
  }

  await deps.publishRealtimeState({
    lessonRunId: input.lessonRunId,
    orgId: config.orgId,
    homeEconomics: config.homeEconomics,
    profile,
    decision,
    result,
  })

  return { status: 'COMMITTED', settlement: result }
}

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

export const readLessonRunConfigWithAdminSdk: ProcessRoundDeps['readLessonRunConfig'] = async (lessonRunId) => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  if (!snap.exists) throw new Error('LessonRun not found')
  const data = snap.data() as {
    orgId?: string
    randomSeed?: string
    restoreGeneration?: number
    templateSnapshot?: { homeEconomics?: HomeEconomicsContent }
  }
  if (!data.templateSnapshot?.homeEconomics) throw new Error('LessonRun has no homeEconomics content')
  // Important I3 (final whole-branch review): `orgId` previously fell back
  // to `''` here (`data.orgId ?? ''`), which reads as superficially valid —
  // it satisfies a naive `exists()` check — but every RTDB security-rule
  // lookup this write later depends on (`orgAccess/''/...`, see
  // `publishRealtimeStateWithAdminSdk`'s doc comment above and
  // `database.rules.json`) fails against an empty-string orgId, producing a
  // PERMANENTLY UNREADABLE `lessonRunPublic`/`lessonRunPrivate`/
  // `lessonRunTeamState` node. This is the exact bug class Phase C Task 20's
  // postmortem already hit in production once. A missing `orgId` on a
  // LessonRun that's actively being settled is a data-integrity bug, not a
  // recoverable default, so it must throw here rather than silently coerce.
  if (!data.orgId) throw new Error('LessonRun is missing orgId — cannot settle round safely.')
  return {
    orgId: data.orgId,
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
    ...(record.voluntaryDrawdownRequestedYen !== undefined ? { voluntaryDrawdownRequestedYen: record.voluntaryDrawdownRequestedYen } : {}),
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
export const commitRoundSettlementWithAdminSdk: ProcessRoundDeps['commitRoundSettlement'] = async (input) => {
  const db = getFirestore()
  return db.runTransaction(async (tx) => {
    const txAdapter: FirestoreTx = {
      get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path, data) => { tx.set(db.doc(path), data) },
    }

    // ---- ALL READS FIRST ----
    const householdPath = `lessonRuns/${input.lessonRunId}/households/${input.householdId}`
    const householdSnap = await txAdapter.get(householdPath)
    if (!householdSnap.exists) throw new Error('HouseholdState not found')
    const storedHousehold = householdSnap.data() as unknown as StoredHouseholdState
    if (storedHousehold.roundIndex !== input.expectedPriorRoundIndex) {
      // Task 4 fix: this re-read may hit a legacy `COMMON_CONDITIONS`
      // document written before `profileId` became required — normalize it
      // through the same `resolveStoredHouseholdState()` path `processRound`
      // uses for its own initial read, so the `ALREADY_SETTLED` result's
      // `householdState.profileId` is a real, guaranteed value rather than
      // a type-only guarantee over a runtime-missing field.
      const currentHousehold = resolveStoredHouseholdState({ stored: storedHousehold, content: input.homeEconomicsContent })
      return { status: 'ALREADY_SETTLED', householdState: currentHousehold }
    }

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
        forcedSettlement: input.forcedSettlement,
      },
      idempotencyKey,
    }, Date.now())

    // ---- WRITE AFTER (household state) ----
    txAdapter.set(householdPath, input.result.newHouseholdState as unknown as Record<string, unknown>)
    return { status: 'COMMITTED' }
  })
}

/**
 * Task 15 — broadcasts this household's round settlement to the three RTDB
 * projections `lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState`
 * (database.rules.json). Called by `processRound` AFTER
 * `commitRoundSettlement`'s Firestore transaction has committed (see this
 * file's step-5 doc comment), so every value broadcast here reflects this
 * round's final, committed state — `input.result.newHouseholdState` IS what
 * `commitRoundSettlement` just wrote, not a stale pre-settlement snapshot.
 *
 * Field-ownership discipline (mirrors `market/processBatch.ts`'s
 * `publishRealtimeStateWithAdminSdk`, this task's brief's named precedent —
 * mandatory):
 * - Every write below calls `.update()`, never `.set()`, on all three RTDB
 *   nodes — a partial multi-field update that leaves sibling keys (written
 *   by Phase B's `publishLessonProjectionWithAdminSdk` or, on a
 *   SOCIAL_STUDIES lessonRun, `market/processBatch.ts`'s own writes to the
 *   very same node paths) untouched. HOME_ECONOMICS and SOCIAL_STUDIES
 *   lessonRuns are mutually exclusive per run (a run's `subject` never
 *   changes), so in practice only one of the two ever writes non-`orgId`
 *   fields onto a given lessonRunId's nodes — but `.update()` is still used
 *   throughout for the same non-destructive discipline `processBatch.ts`
 *   documents.
 * - `orgId` is written on EVERY node below (`lessonRunPublic`,
 *   `lessonRunPrivate`, `lessonRunTeamState`) — required by
 *   `database.rules.json`'s read rules, which read `data.child('orgId')`
 *   off each of these same nodes. Phase C Task 20's own postmortem: a write
 *   missing `orgId` is permanently unreadable (the rule can never
 *   authorize a read against data that was never tagged), so this is
 *   verified explicitly, not left implicit.
 * - `lessonRunPublic/{lessonRunId}` gets only `economicFactors` (inflation/
 *   interest/market-return assumptions) — class-wide, teacher-authored,
 *   safe for every participant. Never the per-household calculation log.
 * - `lessonRunPrivate/{lessonRunId}` gets `householdComputationLog/{householdId}`
 *   — this round's full income/expense/shortfall breakdown plus
 *   `internalRiskFactors` (`HouseholdProfile`, Task 1) and
 *   `internalClaimProbability` (each contracted insurance product's hidden
 *   claim-probability model, Task 6's `InsuranceProduct` catalog) — teacher
 *   only, never mirrored onto `lessonRunPublic` or `lessonRunTeamState`.
 *   Keyed by householdId (not overwritten wholesale) so settling one
 *   household's round never clobbers another household's already-published
 *   log entry on the same shared node.
 * - `lessonRunTeamState/{lessonRunId}/{teamId}` — Task 9 branches this on
 *   course format. COMMON_CONDITIONS (unchanged from Task 15) writes only
 *   the `household` field, built via `toHouseholdStateTeamView` (Task 15
 *   Step 3's allow-list — never `{...household}`) — this team's own
 *   household view only, never another team's, and never the internal
 *   fields above. The 3 advanced formats (ROLE_VARIANT/STAGE_SPLIT/
 *   MULTI_PERSON_PER_TEAM) instead write a SCOPED update at
 *   `households/${householdId}` — a slash-containing RTDB update key
 *   addresses that nested path only, so settling one household never
 *   overwrites the `households` map's other entries (siblings on the same
 *   MULTI_PERSON_PER_TEAM team) — plus the team-agnostic
 *   `courseFormat`/`synchronizedRoundIndex`/`roundStatus` fields, read fresh
 *   from `HouseholdRuntimeControl` (`statusTransition.ts`) at publish time
 *   since this function has no other source for them. `householdOrder` is
 *   NOT rewritten here — it was already published once, in full, by
 *   `afterStatusTransition`'s initial projection (Task 9), and a single
 *   household's settlement never changes team membership.
 */
export const publishRealtimeStateWithAdminSdk: ProcessRoundDeps['publishRealtimeState'] = async (input) => {
  const rtdb = getDatabase()
  const { homeEconomics, profile, result } = input
  const newHousehold = result.newHouseholdState

  const visibleConcepts = resolveVisibleConcepts(homeEconomics.goalPackage)
  const eventDisclosures = buildEventDisclosureView(homeEconomics.lifeEvents, result.occurredEventIds, newHousehold.roundIndex)

  // Fix (Important I2, Task 15 review): broadcast the SAME shortfall
  // options `settleRound` actually computed/considered during settlement
  // (`result.shortfallOptionsConsidered`) rather than independently
  // recomputing `buildShortfallOptions` here from post-settlement state.
  // The previous recomputation diverged from settleRound's actual inputs
  // in two ways: it sized `liquidAssetsYen` off POST-settlement
  // `newHousehold.assetHoldingsYen` (settleRound used PRE-settlement
  // `household.assetHoldingsYen`), and it sized `publicSupportAvailableYen`
  // off static `profile.householdIncomeYen` (settleRound used
  // `grossIncomeYen`, i.e. AFTER life-event income effects). Both are now
  // eliminated by using settleRound's own considered options directly —
  // already `[]` when `shortfallYen === 0` (Critical C1 fix: no shortfall
  // prompt broadcast on a surplus round).
  const shortfallOptions = result.shortfallOptionsConsidered

  // ---- lessonRunPublic: class-wide economic assumptions only, via update() ----
  await rtdb.ref(`lessonRunPublic/${input.lessonRunId}`).update({
    orgId: input.orgId,
    economicFactors: homeEconomics.economicFactors,
  })

  // ---- lessonRunPrivate: teacher-only internal calculation log, via update() ----
  const activeInsuranceProducts = Object.keys(newHousehold.activeInsuranceContracts)
    .map((id) => homeEconomics.insuranceProducts.find((product) => product.id === id))
    .filter((product): product is NonNullable<typeof product> => product !== undefined)
  await rtdb.ref(`lessonRunPrivate/${input.lessonRunId}`).update({
    orgId: input.orgId,
    updatedAtMillis: Date.now(),
    [`householdComputationLog/${newHousehold.householdId}`]: {
      roundIndex: newHousehold.roundIndex,
      occurredEventIds: result.occurredEventIds,
      incomeYen: result.incomeYen,
      expensesYen: result.expensesYen,
      netCashFlowYen: result.netCashFlowYen,
      shortfallYen: result.shortfallYen,
      insuranceBenefitsYen: result.insuranceBenefitsYen,
      internalRiskFactors: profile.internalRiskFactors,
      internalClaimProbability: Object.fromEntries(
        activeInsuranceProducts.map((product) => [product.id, product.internalClaimProbability]),
      ),
    },
  })

  // ---- lessonRunTeamState: branch on course format (see this function's doc comment) ----
  if (homeEconomics.courseFormat === 'COMMON_CONDITIONS') {
    const householdView = toHouseholdStateTeamView(newHousehold, visibleConcepts, eventDisclosures, shortfallOptions)
    await rtdb.ref(`lessonRunTeamState/${input.lessonRunId}/${newHousehold.teamId}`).update({
      orgId: input.orgId,
      household: householdView,
      updatedAtMillis: Date.now(),
    })
  } else {
    const controlSnap = await getFirestore().doc(`lessonRuns/${input.lessonRunId}/householdRuntime/control`).get()
    if (!controlSnap.exists) throw new Error('HouseholdRuntimeControl not found — cannot publish advanced team state.')
    const control = controlSnap.data() as unknown as HouseholdRuntimeControl

    // submittedRoundIndex: this household just consumed its submitted
    // decision for the round that was JUST settled — it has not yet
    // submitted anything for the round it is now on
    // (`newHousehold.roundIndex`, already advanced by settleRound), so this
    // is always null immediately after settlement. See task-9-report.md for
    // the full reasoning on why sibling households' submittedRoundIndex
    // values are intentionally left untouched by this scoped update.
    const entryView = toAdvancedHouseholdTeamEntryView(profile, newHousehold, visibleConcepts, eventDisclosures, shortfallOptions, null)

    await rtdb.ref(`lessonRunTeamState/${input.lessonRunId}/${newHousehold.teamId}`).update({
      orgId: input.orgId,
      courseFormat: control.courseFormat,
      synchronizedRoundIndex: control.synchronizedRoundIndex,
      roundStatus: control.roundStatus,
      [`households/${newHousehold.householdId}`]: entryView,
      updatedAtMillis: Date.now(),
    })
  }
}

export const processRoundDepsWithAdminSdk = (): ProcessRoundDeps => ({
  readLessonRunConfig: readLessonRunConfigWithAdminSdk,
  readHouseholdState: getHouseholdStateWithAdminSdk,
  readHouseholdDecision: readHouseholdDecisionWithAdminSdk,
  settleRoundFn: settleRound,
  commitRoundSettlement: commitRoundSettlementWithAdminSdk,
  publishRealtimeState: publishRealtimeStateWithAdminSdk,
})

export const processRoundWithAdminSdk = (input: ProcessRoundInput): Promise<ProcessRoundExecutionResult> =>
  processRound(processRoundDepsWithAdminSdk(), input)
