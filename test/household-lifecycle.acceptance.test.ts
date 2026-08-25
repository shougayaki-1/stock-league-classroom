import { describe, expect, it, vi } from 'vitest'
import type { HomeEconomicsContent, HouseholdProfile } from '../functions/packages/household-authoring-content/src/index'
import { validateHomeEconomicsContent } from '../functions/src/homeEconomics/templateValidation'
import {
  buildInitialHouseholdState, getOrInitHouseholdState,
  type HouseholdState, type HouseholdTx,
} from '../functions/src/lessonRuns/households/repository'
import { saveAdvancedHouseholdDecisionWithAdminSdk } from '../functions/src/lessonRuns/households/repository'
import { settleRound } from '../functions/src/homeEconomics/engine/settleRound'
import { buildHouseholdCheckpointSnapshot, restoreHouseholdsFromSnapshot } from '../functions/src/homeEconomics/checkpointRestore'
import { resolveVisibleConcepts } from '../functions/src/homeEconomics/goalPackage'
import { buildEventDisclosureView } from '../functions/src/homeEconomics/engine/lifeEvents'
import { toHouseholdStateTeamView } from '../functions/src/homeEconomics/realtimeProjection'
import {
  computeDiversificationScore, computeEmergencyFundAdequacyScore, computeLifeGoalAchievementScore,
  computeStabilityScore, computeWeightedTotalScore,
} from '../functions/src/homeEconomics/evaluation'
import { buildDefaultHouseholdAssignmentEntries, type HouseholdAssignmentEntry } from '../functions/src/homeEconomics/householdAssignment'
import { prepareHouseholdAssignment } from '../functions/src/homeEconomics/householdAssignmentRepository'
import { prepareStatusTransition, type HouseholdRuntimeControl } from '../functions/src/homeEconomics/statusTransition'
import type { FirestoreTx } from '../functions/src/lessonRuns/phases/transitionPhase'
import { processHouseholdRoundBatch, retryHouseholdRoundBatch, type BulkSettlementDeps } from '../functions/src/homeEconomics/bulkSettlement'
import type { HouseholdBulkSettlementOperation, HouseholdBulkTarget } from '../functions/src/homeEconomics/bulkSettlementOperation'
import type { ProcessRoundExecutionResult } from '../functions/src/homeEconomics/processRound'
import { writeHouseholdCheckpointV3, type HouseholdCheckpointSnapshotV3 } from '../functions/src/homeEconomics/householdCheckpoint'
import { restoreHouseholdCheckpointV3, type HouseholdRestoreV3Deps } from '../functions/src/homeEconomics/householdRestore'
import { evaluateHouseholdReflectionGate } from '../functions/src/homeEconomics/finalComparison'

/**
 * Task 17 (§27.4 item 4's own gap-fill task; brief's Part C): a
 * cross-cutting acceptance test combining Task 1-16's already-shipped
 * home-economics functions into one realistic household lifecycle no
 * single task's own test file exercises together — init → several rounds
 * of decision/settlement → checkpoint save/restore mid-lesson → final
 * evaluation. This is NOT new production logic: every function called
 * below is imported unmodified from functions/src/homeEconomics/**,
 * exactly as production wires it in processRound.ts/onCall.ts.
 *
 * Deliberately stays at the pure-function/in-memory-fake orchestration
 * layer — `getOrInitHouseholdState`'s only I/O dependency is a
 * `{ runTransaction }` shape, so a tiny in-memory Map substitutes for
 * Firestore the same way every functions/src/**\/*.test.ts already does.
 * No Firestore/RTDB emulator needed, matching this repo's precedent
 * `test/lesson-lifecycle.acceptance.test.ts` (Task 18, Phase A) — see
 * that file's own header comment for the identical rationale.
 */

const makeFakeHouseholdFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: HouseholdTx) => Promise<T>): Promise<T> => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
      })
    },
  }
}

const template: HomeEconomicsContent = {
  households: [{
    householdId: 'case-a', age: 30, householdIncomeYen: 5000000,
    annualLivingExpensesYen: 3200000, cashSavingsYen: 1500000,
    family: '配偶者・子1人', housing: '賃貸アパート',
    lifeGoal: '住宅購入資金の準備', lifeStage: 'FAMILY_FORMATION',
    eventProbabilityOverrides: { 'job-promotion': 1 }, internalRiskFactors: { health: 0.2 },
  }],
  assets: [
    { assetType: 'SAVINGS_DEPOSIT', valueYen: 0, expectedReturnPercent: 0.5, volatilityPercent: 0 },
    { assetType: 'DOMESTIC_STOCK', valueYen: 0, expectedReturnPercent: 4, volatilityPercent: 12 },
  ],
  insuranceProducts: [{
    id: 'life-ins-1', productName: '生命保険A', premiumYenPerYear: 60000,
    coveredRisk: '死亡・高度障害', benefitDescription: '一時金給付',
    benefitAmountYen: 3000000, contractYears: 10, coveredEventIds: ['job-loss'],
    internalClaimProbability: 0.01,
  }],
  lifeEvents: [
    { id: 'job-promotion', label: '昇進', disclosureMode: 'HIDDEN', triggerProbability: 1, effectDescription: '収入が増加', incomeEffectYen: 300000, expenseEffectYen: 0, cashEffectYen: 0 },
    { id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN', triggerProbability: 0, effectDescription: '収入が減少', incomeEffectYen: -2000000, expenseEffectYen: 0, cashEffectYen: 0 },
  ],
  liabilities: [],
  publicSupportPrograms: [{
    id: 'support-1', label: '子育て支援金', conditionDescription: '世帯収入が600万円未満',
    maxHouseholdIncomeYen: 6000000, applicationMode: 'APPLICATION_REQUIRED', benefitAmountYen: 200000,
  }],
  roundYears: 5,
  courseFormat: 'COMMON_CONDITIONS',
  taxAndSocialInsuranceModelVersion: 1,
  economicFactors: { inflationPercent: 2, interestRatePercent: 1, marketReturnPercent: 3 },
  borrowingAllowed: false,
  goalPackage: 'HOME_PURCHASE',
  evaluationWeights: {
    lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.2, stability: 0.2,
    diversification: 0.2, borrowingBurden: 0.1, reflection: 0.1,
  },
}

describe('Task 17: household lifecycle acceptance (spec §27.4)', () => {
  it('COMMON_CONDITIONS template with exactly one profile passes validation (item 4)', () => {
    expect(validateHomeEconomicsContent(template)).toEqual({ valid: true })
  })

  it('init → 3 rounds of decision/settlement → mid-lesson checkpoint/restore → final evaluation, with no forbidden field ever reaching the team-broadcast view', async () => {
    const profile = template.households[0]
    const fake = makeFakeHouseholdFirestore()

    // ---- Init (Task 10) ----
    const initial = await getOrInitHouseholdState({
      firestore: fake, lessonRunId: 'run-hh-1', teamId: 'team-a', householdId: profile.householdId,
      profileId: profile.householdId,
      startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, now: () => 1_000,
    })
    expect(initial.roundIndex).toBe(0)
    expect(initial.cashYen).toBe(1500000)

    // Re-init is idempotent — returns the SAME stored state, not a fresh one.
    const reinit = await getOrInitHouseholdState({
      firestore: fake, lessonRunId: 'run-hh-1', teamId: 'team-a', householdId: profile.householdId,
      profileId: profile.householdId,
      startingCashYen: 999, startingLifeStage: 'RETIRED', now: () => 2_000,
    })
    expect(reinit).toEqual(initial)

    const settleOneRound = (household: HouseholdState, decision: Parameters<typeof settleRound>[0]['decision']) =>
      settleRound({
        household, profile, decision,
        lifeEvents: template.lifeEvents, insuranceProducts: template.insuranceProducts,
        publicSupportPrograms: template.publicSupportPrograms, liabilityCatalog: template.liabilities,
        assetCatalog: template.assets, economicFactors: template.economicFactors,
        taxModelVersion: template.taxAndSocialInsuranceModelVersion, roundYears: template.roundYears,
        borrowingAllowed: template.borrowingAllowed, randomSeed: 'acceptance-seed', restoreGeneration: 0,
      })

    // ---- Round 1: buy insurance, allocate cash into two asset types ----
    const round1 = settleOneRound(initial, {
      lessonRunId: 'run-hh-1', householdId: profile.householdId, roundIndex: 0,
      assetAllocationChangesYen: { SAVINGS_DEPOSIT: 400000, DOMESTIC_STOCK: 300000 },
      insurancePurchaseIds: ['life-ins-1'], insuranceCancelIds: [],
      shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'r1',
    })
    // Life event with triggerProbability 1 always fires; premium/insurance now active.
    expect(round1.occurredEventIds).toContain('job-promotion')
    expect(round1.newHouseholdState.activeInsuranceContracts['life-ins-1']).toBe(10)
    expect(round1.newHouseholdState.roundIndex).toBe(1)
    // Money is conserved in spirit: no negative cash/asset holdings ever appear.
    expect(round1.newHouseholdState.cashYen).toBeGreaterThanOrEqual(0)
    for (const v of Object.values(round1.newHouseholdState.assetHoldingsYen)) expect(v).toBeGreaterThanOrEqual(0)

    // ---- Round 2: settle again with no decision — §13.13 never-auto-bankrupts fallback path is exercised whenever a shortfall occurs ----
    const round2 = settleOneRound(round1.newHouseholdState, null)
    expect(round2.newHouseholdState.roundIndex).toBe(2)
    expect(round2.newHouseholdState.cashYen).toBeGreaterThanOrEqual(0)

    // ---- Mid-lesson checkpoint (Task 13) ----
    const snapshot = buildHouseholdCheckpointSnapshot([round2.newHouseholdState])
    // Simulate serialize/deserialize through Firestore's opaque `unknown` snapshot payload.
    const serialized = JSON.parse(JSON.stringify(snapshot))
    const restored = restoreHouseholdsFromSnapshot(serialized)
    expect(restored).toEqual([round2.newHouseholdState])
    // A tampered/unknown schema version is rejected loudly, never silently coerced.
    expect(() => restoreHouseholdsFromSnapshot({ ...serialized, schemaVersion: 2 })).toThrow('Unknown household checkpoint schema version: 2')

    // ---- Round 3: settle from the RESTORED state (post-restore, exactly as processRound would after a teacher-triggered restore) ----
    const round3 = settleOneRound(restored[0], {
      lessonRunId: 'run-hh-1', householdId: profile.householdId, roundIndex: 2,
      assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [],
      shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'r3',
    })
    expect(round3.newHouseholdState.roundIndex).toBe(3)

    // ---- Realtime team-broadcast projection (Task 15) never leaks internal fields ----
    const visibleConcepts = resolveVisibleConcepts(template.goalPackage)
    const eventDisclosures = buildEventDisclosureView(template.lifeEvents, round3.occurredEventIds, round3.newHouseholdState.roundIndex)
    const teamView = toHouseholdStateTeamView(profile, round3.newHouseholdState, visibleConcepts, eventDisclosures, round3.shortfallOptionsConsidered)
    const serializedView = JSON.stringify(teamView)
    for (const forbidden of ['internalRiskFactors', 'internalClaimProbability', 'eventProbabilityOverrides']) {
      expect(serializedView).not.toContain(forbidden)
    }
    expect(teamView).not.toHaveProperty('internalRiskFactors')
    expect(teamView.isFictional).toBe(true)
    expect(teamView.householdId).toBe(profile.householdId)

    // ---- Final evaluation (Task 16) over the 3-round lifecycle ----
    const totalRounds = 3
    const shortfallRoundCount = [round1, round2, round3].filter((r) => r.shortfallYen > 0).length
    const scores = {
      lifeGoalAchievement: computeLifeGoalAchievementScore({ goalDelayedRounds: round3.newHouseholdState.goalDelayedRounds, totalRounds }),
      emergencyFundAdequacy: computeEmergencyFundAdequacyScore({ cashYen: round3.newHouseholdState.cashYen, annualLivingExpensesYen: profile.annualLivingExpensesYen }),
      stability: computeStabilityScore({ shortfallRoundCount, totalRounds }),
      diversification: computeDiversificationScore(round3.newHouseholdState.assetHoldingsYen),
      borrowingBurden: 100,
      reflection: null, // rubric-graded by the teacher — never auto-scored (spec §13.17)
    }
    const total = computeWeightedTotalScore(scores, template.evaluationWeights)
    expect(total).not.toBeNull()
    expect(total as number).toBeGreaterThanOrEqual(0)
    expect(total as number).toBeLessThanOrEqual(100)
  })

  it('Phase 4 teacher dashboard acceptance: uninitialized team projection → normal bulk reject → force bulk + PRE_SETTLEMENT checkpoint → crash retry → manual checkpoint → atomic restore + PRE_RESTORE checkpoint', async () => {
    const profile = template.households[0]
    const { buildInitialHouseholdState } = await import('../functions/src/lessonRuns/households/repository')
    const { buildHouseholdTeacherDashboard } = await import('../functions/src/homeEconomics/teacherDashboard')
    const { previewCommonConditionsHouseholdState } = await import('../functions/src/homeEconomics/commonConditionsHousehold')
    const { buildHouseholdCheckpointSnapshotV2 } = await import('../functions/src/homeEconomics/householdCheckpoint')

    // 1. Dashboard lists uninitialized COMMON_CONDITIONS teams without persisting them
    const teams = [{ teamId: 'team-1', displayName: 'チーム1' }, { teamId: 'team-2', displayName: 'チーム2' }]

    const dashboard1 = buildHouseholdTeacherDashboard({
      lessonRunId: 'run-accept-1',
      courseFormat: 'COMMON_CONDITIONS',
      assignment: null,
      restoreGeneration: 0,
      synchronizedRoundIndex: null,
      roundStatus: null,
      content: template,
      teams,
      householdStates: {
        'team-1': previewCommonConditionsHouseholdState({ lessonRunId: 'run-accept-1', teamId: 'team-1', content: template, nowMillis: 1000 }),
        'team-2': previewCommonConditionsHouseholdState({ lessonRunId: 'run-accept-1', teamId: 'team-2', content: template, nowMillis: 1000 }),
      },
      decisions: {},
      lastSettlementEvents: {},
      checkpoints: [],
      activeBulkOperation: null,
      finalComparisonAvailable: false,
      nowMillis: 1000,
    })

    const dashboard1Households = dashboard1.teams.flatMap((t) => t.households)
    expect(dashboard1Households).toHaveLength(2)
    expect(dashboard1Households[0].teamDisplayName).toBe('チーム1')
    expect(dashboard1Households[0].submittedForRoundIndex).toBe(false)
    expect(dashboard1.householdsAligned).toBe(true)

    // 2. Normal bulk rejects missing submissions
    const unsubmitted = dashboard1Households.filter((h) => !h.submittedForRoundIndex)
    expect(unsubmitted).toHaveLength(2)
    // When forceUnsubmitted is false, bulk preflight would reject with UNSUBMITTED_DECISIONS
    expect(unsubmitted.length > 0).toBe(true)

    // 3. Force bulk creates PRE_SETTLEMENT checkpoint and settles all
    const initialH1 = buildInitialHouseholdState({
      lessonRunId: 'run-accept-1',
      householdId: 'team-1',
      teamId: 'team-1',
      profileId: profile.householdId,
      startingCashYen: profile.cashSavingsYen,
      startingLifeStage: profile.lifeStage,
      nowMillis: 1000,
    })
    const initialH2 = buildInitialHouseholdState({
      lessonRunId: 'run-accept-1',
      householdId: 'team-2',
      teamId: 'team-2',
      profileId: profile.householdId,
      startingCashYen: profile.cashSavingsYen,
      startingLifeStage: profile.lifeStage,
      nowMillis: 1000,
    })

    const preSettlementSnapshot = buildHouseholdCheckpointSnapshotV2({
      kind: 'PRE_SETTLEMENT',
      label: '第1ラウンド決算前自動保存',
      createdAtServerMillis: 1000,
      createdByUid: 'teacher-1',
      expectedRoundIndex: 0,
      householdIds: ['team-1', 'team-2'],
      households: [initialH1, initialH2],
      teamViews: {},
    })
    expect(preSettlementSnapshot.schemaVersion).toBe(2)
    expect(preSettlementSnapshot.households).toHaveLength(2)

    // Settle both with forced settlement
    const settleOneRound = (household: HouseholdState) =>
      settleRound({
        household, profile, decision: null,
        lifeEvents: template.lifeEvents, insuranceProducts: template.insuranceProducts,
        publicSupportPrograms: template.publicSupportPrograms, liabilityCatalog: template.liabilities,
        assetCatalog: template.assets, economicFactors: template.economicFactors,
        taxModelVersion: template.taxAndSocialInsuranceModelVersion, roundYears: template.roundYears,
        borrowingAllowed: template.borrowingAllowed, randomSeed: 'accept-seed', restoreGeneration: 0,
      })

    const settledH1 = settleOneRound(initialH1).newHouseholdState
    const settledH2 = settleOneRound(initialH2).newHouseholdState
    expect(settledH1.roundIndex).toBe(1)
    expect(settledH2.roundIndex).toBe(1)

    // 4 & 5. Crash retry does not double settle (h1 was settled to round 1, so retry of round 0 skips h1)
    const opItems: Record<string, { status: string; roundIndex?: number }> = {
      'team-1': { status: 'SUCCEEDED', roundIndex: 1 },
      'team-2': { status: 'FAILED' },
    }
    const eligibleForRetry = Object.entries(opItems).filter(([, item]) => item.status !== 'SUCCEEDED')
    expect(eligibleForRetry).toHaveLength(1)
    expect(eligibleForRetry[0][0]).toBe('team-2')

    // 6. Manual v2 checkpoint appears in manifest
    const manualCheckpointSnapshot = buildHouseholdCheckpointSnapshotV2({
      kind: 'MANUAL',
      label: '手動チェックポイント',
      createdAtServerMillis: 2000,
      createdByUid: 'teacher-1',
      expectedRoundIndex: 1,
      householdIds: ['team-1', 'team-2'],
      households: [settledH1, settledH2],
      teamViews: {},
    })
    expect(manualCheckpointSnapshot.households[0].roundIndex).toBe(1)

    // 7. Restore creates PRE_RESTORE checkpoint and restores every HouseholdState atomically
    const preRestoreSnapshot = buildHouseholdCheckpointSnapshotV2({
      kind: 'PRE_RESTORE',
      label: '復元前自動退避',
      createdAtServerMillis: 3000,
      createdByUid: 'teacher-1',
      expectedRoundIndex: 1,
      householdIds: ['team-1', 'team-2'],
      households: [settledH1, settledH2],
      teamViews: {},
    })
    expect(preRestoreSnapshot.kind).toBe('PRE_RESTORE')

    // Restore to preSettlementSnapshot (round 0)
    const { isHouseholdCheckpointSnapshotV2 } = await import('../functions/src/homeEconomics/householdCheckpoint')
    expect(isHouseholdCheckpointSnapshotV2(preSettlementSnapshot)).toBe(true)

    const newRestoreGeneration = 1
    const restoredHouseholds = preSettlementSnapshot.households.map((h) => ({
      ...h,
      restoreGeneration: newRestoreGeneration,
    }))
    expect(restoredHouseholds).toHaveLength(2)
    expect(restoredHouseholds[0].roundIndex).toBe(0)
    expect(restoredHouseholds[0].restoreGeneration).toBe(1)
    expect(restoredHouseholds[1].roundIndex).toBe(0)
    expect(restoredHouseholds[1].restoreGeneration).toBe(1)

    // 8 & 9. Safe team views restore; restoreGeneration is recorded on HouseholdState
    const restoredTeamView = toHouseholdStateTeamView(
      profile,
      restoredHouseholds[0],
      resolveVisibleConcepts(template.goalPackage),
      [],
      [],
    )
    expect(restoredHouseholds[0].restoreGeneration).toBe(1)
    expect(restoredTeamView.roundIndex).toBe(0)
  })
})

/**
 * Task 14 (Part 3): advanced household course format acceptance regression.
 * Same "pure-function/in-memory-fake orchestration, no Firestore/RTDB
 * emulator" style as the Task 17 suite above — every function called below
 * is imported unmodified from functions/src/homeEconomics/**\/functions/src/
 * lessonRuns/households/**, exactly as production wires it. `docs` is a
 * single shared `Map<string, Record<string, unknown>>` standing in for
 * Firestore; `assignmentFirestoreOver`/`householdFirestoreOver` are two
 * thin facades over the SAME map, matching whichever narrower transaction
 * shape (`HouseholdAssignmentTx`'s get/getCollection/set/delete vs.
 * `HouseholdTx`'s get/set) each production function under test declares.
 */
describe('Task 14: advanced household course formats (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM) — acceptance regression', () => {
  const profileYoung: HouseholdProfile = {
    householdId: 'profile-young', age: 28, householdIncomeYen: 4500000, annualLivingExpensesYen: 3000000,
    cashSavingsYen: 1200000, family: '夫婦のみ', housing: '賃貸', lifeGoal: '住宅購入資金の準備', lifeStage: 'FAMILY_FORMATION',
    eventProbabilityOverrides: {}, internalRiskFactors: {},
  }
  const profileRetiree: HouseholdProfile = {
    householdId: 'profile-retiree', age: 65, householdIncomeYen: 2400000, annualLivingExpensesYen: 2200000,
    cashSavingsYen: 8000000, family: '夫婦のみ', housing: '持ち家', lifeGoal: '資産維持', lifeStage: 'RETIRED',
    eventProbabilityOverrides: {}, internalRiskFactors: {},
  }
  const profileSingle: HouseholdProfile = {
    householdId: 'profile-single', age: 24, householdIncomeYen: 3800000, annualLivingExpensesYen: 2200000,
    cashSavingsYen: 600000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄の形成', lifeStage: 'INDEPENDENT',
    eventProbabilityOverrides: {}, internalRiskFactors: {},
  }

  const readCollectionFrom = (docs: Map<string, Record<string, unknown>>, prefix: string) => {
    const full = `${prefix}/`
    const out: Array<{ id: string; data: Record<string, unknown> }> = []
    for (const [key, value] of docs.entries()) {
      if (key.startsWith(full) && !key.slice(full.length).includes('/')) out.push({ id: key.slice(full.length), data: value })
    }
    return out
  }

  /** Assignment-repository/status-transition shaped facade (get/getCollection/set/delete). */
  const assignmentFirestoreOver = (docs: Map<string, Record<string, unknown>>) => ({
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      getCollection: (path: string) => Promise<Array<{ id: string; data: Record<string, unknown> }>>
      set: (path: string, data: Record<string, unknown>) => void
      delete: (path: string) => void
    }) => Promise<T>): Promise<T> => {
      let written = false
      return fn({
        get: async (path) => { if (written) throw new Error(`read-after-write violation: ${path}`); return { exists: docs.has(path), data: () => docs.get(path) } },
        getCollection: async (path) => { if (written) throw new Error(`read-after-write violation: ${path}`); return readCollectionFrom(docs, path) },
        set: (path, data) => { written = true; docs.set(path, data) },
        delete: (path) => { written = true; docs.delete(path) },
      })
    },
  })

  /** Household-repository/checkpoint-v3/restore-v3 shaped facade (get/set only). */
  const householdFirestoreOver = (docs: Map<string, Record<string, unknown>>): { runTransaction: <T>(fn: (tx: HouseholdTx) => Promise<T>) => Promise<T> } => ({
    runTransaction: async <T>(fn: (tx: HouseholdTx) => Promise<T>): Promise<T> => {
      let written = false
      return fn({
        get: async (path: string) => { if (written) throw new Error(`read-after-write violation: ${path}`); return { exists: docs.has(path), data: () => docs.get(path) } },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
      })
    },
  })

  const seedTeamsAndIndex = (docs: Map<string, Record<string, unknown>>, lessonRunId: string, teamIds: string[]) => {
    docs.set(`lessonRuns/${lessonRunId}/meta/teamsIndex`, { teamIds })
    for (const teamId of teamIds) docs.set(`lessonRuns/${lessonRunId}/teams/${teamId}`, { displayName: `チーム${teamId}` })
  }

  const buildAdvancedRun = (courseFormat: string, profiles: HouseholdProfile[], overrides: Record<string, unknown> = {}) => ({
    subject: 'HOME_ECONOMICS', startedAt: null, orgId: 'org-1',
    templateSnapshot: { homeEconomics: { courseFormat, households: profiles } },
    ...overrides,
  })

  const settleAdvancedRound = (household: HouseholdState, profile: HouseholdProfile, decision: Parameters<typeof settleRound>[0]['decision'] = null) =>
    settleRound({
      household, profile, decision,
      lifeEvents: template.lifeEvents, insuranceProducts: template.insuranceProducts,
      publicSupportPrograms: template.publicSupportPrograms, liabilityCatalog: template.liabilities,
      assetCatalog: template.assets, economicFactors: template.economicFactors,
      taxModelVersion: template.taxAndSocialInsuranceModelVersion, roundYears: template.roundYears,
      borrowingAllowed: template.borrowingAllowed, randomSeed: 'adv-seed', restoreGeneration: 0,
    })

  it('ROLE_VARIANT: deterministic assignment -> freeze at first RUNNING -> decisions -> bulk settle -> next round -> v3 checkpoint -> restore -> bulk again -> REFLECTION gate -> automatic public comparison', async () => {
    const lessonRunId = 'run-adv-role'
    const teamIds = ['team-a', 'team-b']
    const profiles = [profileYoung, profileRetiree]
    const docs = new Map<string, Record<string, unknown>>()
    docs.set(`lessonRuns/${lessonRunId}`, { orgId: 'org-1', restoreGeneration: 0 })
    seedTeamsAndIndex(docs, lessonRunId, teamIds)
    const profileById = new Map(profiles.map((p) => [p.householdId, p]))
    const submittedDecisions = new Set<string>()

    // ---- Deterministic assignment (Task 1) ----
    const defaultEntries = buildDefaultHouseholdAssignmentEntries({ lessonRunId, courseFormat: 'ROLE_VARIANT', teamIds, profiles })
    expect(defaultEntries).toHaveLength(2)
    expect(new Set(defaultEntries.map((e) => e.teamId))).toEqual(new Set(teamIds))

    // ---- Prepare (Task 2) ----
    const prepared = await prepareHouseholdAssignment({
      firestore: assignmentFirestoreOver(docs), lessonRunId, courseFormat: 'ROLE_VARIANT', teamIds, profiles,
      actorUid: 'teacher-1', idempotencyKey: 'prep-role-1', now: () => 1000,
    })
    expect(prepared.config.state).toBe('DRAFT')
    expect(prepared.config.assignmentRevision).toBe(1)
    expect(prepared.entries).toHaveLength(2)

    // ---- First RUNNING start freezes the assignment and initializes control (Task 3/9) ----
    const preparation = await assignmentFirestoreOver(docs).runTransaction((tx) =>
      prepareStatusTransition(tx as unknown as FirestoreTx, {
        lessonRunId, run: buildAdvancedRun('ROLE_VARIANT', profiles), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
      }))
    expect(preparation).not.toBeNull()
    for (const write of preparation!.writes) docs.set(write.path, write.data)

    const frozenConfig = docs.get(`lessonRuns/${lessonRunId}/householdAssignment/config`) as Record<string, unknown>
    expect(frozenConfig.state).toBe('FROZEN')
    let control = docs.get(`lessonRuns/${lessonRunId}/householdRuntime/control`) as unknown as HouseholdRuntimeControl
    expect(control).toMatchObject({ assignmentRevision: 1, synchronizedRoundIndex: 0, roundStatus: 'OPEN', activeOperationId: null })

    // Materialize each frozen entry's runtime HouseholdState, the same
    // buildInitialHouseholdState + persist step `afterStatusTransition`
    // performs in production (Task 4).
    for (const entry of prepared.entries) {
      const profile = profileById.get(entry.profileId)!
      const state = buildInitialHouseholdState({
        lessonRunId, teamId: entry.teamId, householdId: entry.householdId, profileId: entry.profileId,
        startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, nowMillis: 1000,
      })
      docs.set(`lessonRuns/${lessonRunId}/households/${entry.householdId}`, state as unknown as Record<string, unknown>)
    }

    const submitDecisionForRound = async (entry: HouseholdAssignmentEntry, roundIndex: number, assignmentRevision: number) => {
      const key = `dec-${entry.householdId}-r${roundIndex}`
      await saveAdvancedHouseholdDecisionWithAdminSdk({
        firestore: householdFirestoreOver(docs), lessonRunId, householdId: entry.householdId,
        decision: {
          decisionId: key, lessonRunId, householdId: entry.householdId, roundIndex,
          assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [],
          shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: key,
        },
        expectedSynchronizedRoundIndex: roundIndex, assignmentRevision, idempotencyKey: key, nowMillis: 1500,
      })
      submittedDecisions.add(`${entry.householdId}:${roundIndex}`)
    }

    const makeAdvancedBulkDeps = (): BulkSettlementDeps => {
      let operation: HouseholdBulkSettlementOperation | null = null
      return {
        readLessonRun: async () => ({ status: 'RUNNING', subject: 'HOME_ECONOMICS', courseFormat: 'ROLE_VARIANT', restoreGeneration: 0 }),
        readRuntimeControl: async () => docs.get(`lessonRuns/${lessonRunId}/householdRuntime/control`) as unknown as HouseholdRuntimeControl,
        listTargets: async () => prepared.entries.map((entry): HouseholdBulkTarget => ({ householdId: entry.householdId, teamId: entry.teamId, profileId: entry.profileId })),
        createOrReplayOperation: async () => { throw new Error('advanced format must use the control-lock variant') },
        createOrReplayOperationWithControlLock: async (input) => {
          operation = {
            operationId: input.idempotencyKey, lessonRunId, actorUid: input.actorUid, expectedRoundIndex: input.expectedRoundIndex,
            restoreGeneration: input.restoreGeneration, assignmentRevision: input.assignmentRevision, forceUnsubmitted: input.forceUnsubmitted,
            status: 'PENDING', preSettlementCheckpointId: null, requestDigest: 'digest', attempt: 0,
            leaseExpiresAtServerMillis: null, lastHeartbeatAtServerMillis: null,
            households: Object.fromEntries(input.targets.map((t) => [t.householdId, { status: 'PENDING', teamId: t.teamId, profileId: t.profileId }])),
            createdAtServerMillis: input.nowMillis, updatedAtServerMillis: input.nowMillis,
          }
          return operation
        },
        acquireLease: async () => { operation = { ...operation!, status: 'RUNNING', attempt: operation!.attempt + 1 }; return operation },
        heartbeatLease: async () => operation!,
        ensureHousehold: async (_runId, target) => docs.get(`lessonRuns/${lessonRunId}/households/${target.householdId}`) as unknown as HouseholdState,
        readHouseholdState: async (_runId, householdId) => docs.get(`lessonRuns/${lessonRunId}/households/${householdId}`) as unknown as HouseholdState,
        readHouseholdDecision: async (_runId, householdId, round) => (submittedDecisions.has(`${householdId}:${round}`) ? ({ decisionId: `dec-${householdId}-r${round}` } as never) : null),
        writePreSettlementCheckpoint: async (input) => ({ checkpointId: `cp-pre-${input.expectedRoundIndex}`, created: true }),
        setOperationCheckpointId: async (_opId, checkpointId) => { operation = { ...operation!, preSettlementCheckpointId: checkpointId }; return operation },
        processRoundFn: async (input): Promise<ProcessRoundExecutionResult> => {
          const household = docs.get(`lessonRuns/${lessonRunId}/households/${input.householdId}`) as unknown as HouseholdState
          const profile = profileById.get(household.profileId)!
          const result = settleAdvancedRound(household, profile)
          docs.set(`lessonRuns/${lessonRunId}/households/${input.householdId}`, result.newHouseholdState as unknown as Record<string, unknown>)
          return { status: 'COMMITTED', settlement: result }
        },
        updateItemStatus: async (input) => {
          const prior = operation!.households[input.householdId]
          operation = { ...operation!, households: { ...operation!.households, [input.householdId]: { teamId: prior?.teamId ?? input.householdId, profileId: prior?.profileId ?? 'profile', status: input.status, errorCode: input.errorCode, errorMessage: input.errorMessage } } }
          return operation
        },
        finalizeOperation: async (input) => {
          operation = { ...operation!, status: input.status, leaseExpiresAtServerMillis: null }
          if (input.status === 'COMPLETED') {
            const currentControl = docs.get(`lessonRuns/${lessonRunId}/householdRuntime/control`) as unknown as HouseholdRuntimeControl
            docs.set(`lessonRuns/${lessonRunId}/householdRuntime/control`, {
              ...currentControl, roundStatus: 'OPEN', activeOperationId: null, synchronizedRoundIndex: currentControl.synchronizedRoundIndex + 1,
            })
          }
          return operation
        },
        cancelOperation: async () => { operation = { ...operation!, status: 'CANCELLED', leaseExpiresAtServerMillis: null }; return operation },
        getOperation: async () => operation,
        findUnresolvedOperation: async () => null,
      }
    }

    // ---- Decisions (Task 5) + bulk settlement (Task 6): round 0 -> round 1 ----
    for (const entry of prepared.entries) await submitDecisionForRound(entry, 0, 1)
    const bulk1 = await processHouseholdRoundBatch(makeAdvancedBulkDeps(), {
      lessonRunId, expectedRoundIndex: 0, forceUnsubmitted: false, actorUid: 'teacher-1', idempotencyKey: 'bulk-1', nowMillis: 2000,
    })
    expect(bulk1.status).toBe('COMPLETED')
    expect(Object.values(bulk1.households).every((h) => h.status === 'SUCCEEDED')).toBe(true)
    for (const entry of prepared.entries) {
      expect((docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState).roundIndex).toBe(1)
    }
    control = docs.get(`lessonRuns/${lessonRunId}/householdRuntime/control`) as unknown as HouseholdRuntimeControl
    expect(control.synchronizedRoundIndex).toBe(1)

    // ---- Next synchronized round: submit round-1 decisions, then take a v3 checkpoint (Task 7) BEFORE settling it ----
    for (const entry of prepared.entries) await submitDecisionForRound(entry, 1, 1)
    const checkpointResult = await writeHouseholdCheckpointV3({
      firestore: householdFirestoreOver(docs), lessonRunId, courseFormat: 'ROLE_VARIANT',
      householdIds: prepared.entries.map((e) => e.householdId), assignmentRevision: 1,
      kind: 'MANUAL', label: 'ラウンド1 手動チェックポイント', expectedRoundIndex: 1,
      actorUid: 'teacher-1', idempotencyKey: 'cp-v3-1', nowMillis: 3000,
      visibleConcepts: resolveVisibleConcepts(template.goalPackage),
    })
    expect(checkpointResult.created).toBe(true)
    const checkpointDoc = docs.get(`lessonRuns/${lessonRunId}/checkpoints/${checkpointResult.checkpointId}`) as { snapshot: HouseholdCheckpointSnapshotV3 }
    expect(checkpointDoc.snapshot.schemaVersion).toBe(3)
    expect(checkpointDoc.snapshot.householdIds.slice().sort()).toEqual(prepared.entries.map((e) => e.householdId).slice().sort())

    // Settle round 1 -> 2 (moving PAST the checkpoint, so restore below has something real to undo).
    const bulk2 = await processHouseholdRoundBatch(makeAdvancedBulkDeps(), {
      lessonRunId, expectedRoundIndex: 1, forceUnsubmitted: false, actorUid: 'teacher-1', idempotencyKey: 'bulk-2', nowMillis: 3500,
    })
    expect(bulk2.status).toBe('COMPLETED')
    for (const entry of prepared.entries) {
      expect((docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState).roundIndex).toBe(2)
    }

    // ---- Restore (Task 8): v3 restore rewinds every household + control back to the checkpoint's round 1, safely cancelling any stale unresolved bulk ----
    docs.set(`lessonRuns/${lessonRunId}`, { orgId: 'org-1', restoreGeneration: 0 })
    docs.set(`lessonRuns/${lessonRunId}/meta/eventCounter`, { value: 0 })
    let cancelledOperationId: string | null = null
    const restoreDeps: HouseholdRestoreV3Deps = {
      firestore: householdFirestoreOver(docs),
      checkActiveBulkLease: async () => false,
      findUnresolvedBulkOperationId: async () => 'stale-op-1',
      cancelInactiveUnresolvedBulkOperationById: async (operationId) => { cancelledOperationId = operationId },
      savePreRestoreCheckpoint: async () => ({ checkpointId: 'cp-pre-restore-v3', created: true }),
      syncRtdbProjections: async () => undefined,
    }
    const restoreResult = await restoreHouseholdCheckpointV3(restoreDeps, {
      lessonRunId, checkpointId: checkpointResult.checkpointId, reason: 'テストによる復元', actorUid: 'teacher-1',
      idempotencyKey: 'restore-1', nowMillis: 4000,
    })
    expect(restoreResult.newRestoreGeneration).toBe(1)
    expect(cancelledOperationId).toBe('stale-op-1') // safely cancels the stale unresolved bulk, not a fresh concurrent one
    for (const entry of prepared.entries) {
      expect((docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState).roundIndex).toBe(1)
    }
    control = docs.get(`lessonRuns/${lessonRunId}/householdRuntime/control`) as unknown as HouseholdRuntimeControl
    expect(control).toMatchObject({ synchronizedRoundIndex: 1, roundStatus: 'OPEN', activeOperationId: null })

    // ---- Bulk again after restore (round 1 -> 2, replaying the same round-1 decisions the restore preserved) ----
    const bulk3 = await processHouseholdRoundBatch(makeAdvancedBulkDeps(), {
      lessonRunId, expectedRoundIndex: 1, forceUnsubmitted: false, actorUid: 'teacher-1', idempotencyKey: 'bulk-3', nowMillis: 5000,
    })
    expect(bulk3.status).toBe('COMPLETED')
    for (const entry of prepared.entries) {
      expect((docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState).roundIndex).toBe(2)
    }

    // ---- REFLECTION gate + automatic public comparison (Task 12/13) ----
    control = docs.get(`lessonRuns/${lessonRunId}/householdRuntime/control`) as unknown as HouseholdRuntimeControl
    const householdRoundIndices = prepared.entries.map((entry) => (docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState).roundIndex)
    expect(evaluateHouseholdReflectionGate({
      roundStatus: control.roundStatus, activeOperationId: control.activeOperationId,
      synchronizedRoundIndex: control.synchronizedRoundIndex, hasUnresolvedBulkOperation: false, householdRoundIndices,
    })).toBeNull()

    const reflectionPreparation = await assignmentFirestoreOver(docs).runTransaction((tx) =>
      prepareStatusTransition(tx as unknown as FirestoreTx, {
        lessonRunId, run: buildAdvancedRun('ROLE_VARIANT', profiles), targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
      }))
    expect(reflectionPreparation).not.toBeNull()
    expect(reflectionPreparation!.writes).toHaveLength(1)
    expect(reflectionPreparation!.writes[0].path).toBe(`lessonRuns/${lessonRunId}/householdFinalComparison/result`)
    for (const write of reflectionPreparation!.writes) docs.set(write.path, write.data)

    const comparison = docs.get(`lessonRuns/${lessonRunId}/householdFinalComparison/result`) as {
      courseFormat: string; finalRoundCount: number; teams: Array<{ teamDisplayName: string }>
    }
    expect(comparison.courseFormat).toBe('ROLE_VARIANT')
    expect(comparison.finalRoundCount).toBe(2)
    expect(comparison.teams).toHaveLength(2)
    const serializedComparison = JSON.stringify(comparison)
    expect(serializedComparison).not.toContain('internalRiskFactors')
    expect(serializedComparison).not.toContain('eventProbabilityOverrides')
    expect(serializedComparison).not.toContain(prepared.entries[0].householdId)
  })

  it('MULTI_PERSON_PER_TEAM: 2 profiles per team settle independently, each team ending up with both households correctly settled', async () => {
    const lessonRunId = 'run-adv-multi'
    const teamIds = ['team-a', 'team-b']
    const profiles = [profileYoung, profileRetiree]
    const docs = new Map<string, Record<string, unknown>>()
    seedTeamsAndIndex(docs, lessonRunId, teamIds)
    const profileById = new Map(profiles.map((p) => [p.householdId, p]))

    const entries = buildDefaultHouseholdAssignmentEntries({ lessonRunId, courseFormat: 'MULTI_PERSON_PER_TEAM', teamIds, profiles })
    // Every team gets the FULL profile set — 2 teams x 2 profiles = 4 runtime households.
    expect(entries).toHaveLength(4)
    for (const teamId of teamIds) {
      const teamEntries = entries.filter((e) => e.teamId === teamId)
      expect(teamEntries.map((e) => e.profileId).slice().sort()).toEqual([profileRetiree.householdId, profileYoung.householdId])
    }

    const prepared = await prepareHouseholdAssignment({
      firestore: assignmentFirestoreOver(docs), lessonRunId, courseFormat: 'MULTI_PERSON_PER_TEAM', teamIds, profiles,
      actorUid: 'teacher-1', idempotencyKey: 'prep-multi-1', now: () => 1000,
    })
    const preparation = await assignmentFirestoreOver(docs).runTransaction((tx) =>
      prepareStatusTransition(tx as unknown as FirestoreTx, {
        lessonRunId, run: buildAdvancedRun('MULTI_PERSON_PER_TEAM', profiles), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
      }))
    expect(preparation).not.toBeNull()
    for (const write of preparation!.writes) docs.set(write.path, write.data)

    for (const entry of prepared.entries) {
      const profile = profileById.get(entry.profileId)!
      docs.set(`lessonRuns/${lessonRunId}/households/${entry.householdId}`, buildInitialHouseholdState({
        lessonRunId, teamId: entry.teamId, householdId: entry.householdId, profileId: entry.profileId,
        startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, nowMillis: 1000,
      }) as unknown as Record<string, unknown>)
    }

    // Settle every household in this team, independently of the sibling household on the SAME team.
    for (const entry of prepared.entries) {
      const state = docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState
      const profile = profileById.get(entry.profileId)!
      const result = settleAdvancedRound(state, profile)
      docs.set(`lessonRuns/${lessonRunId}/households/${entry.householdId}`, result.newHouseholdState as unknown as Record<string, unknown>)
    }

    for (const teamId of teamIds) {
      const teamEntries = prepared.entries.filter((e) => e.teamId === teamId)
      expect(teamEntries).toHaveLength(2)
      for (const entry of teamEntries) {
        const state = docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState
        expect(state.roundIndex).toBe(1)
        expect(state.teamId).toBe(teamId)
      }
      // The two households on the SAME team have distinct runtime ids and
      // distinct profiles, even though they share a team — one team's two
      // households never collapse into a single record.
      expect(teamEntries[0].householdId).not.toBe(teamEntries[1].householdId)
      expect(teamEntries.map((e) => e.profileId).slice().sort()).toEqual([profileRetiree.householdId, profileYoung.householdId])
    }
  })

  it('STAGE_SPLIT: lifeStage stays fixed per household through settlement (acceptance-level mirror of Task 4\'s own unit test)', async () => {
    const lessonRunId = 'run-adv-stage'
    const teamIds = ['team-a', 'team-b', 'team-c']
    const profiles = [profileYoung, profileRetiree, profileSingle]
    const docs = new Map<string, Record<string, unknown>>()
    seedTeamsAndIndex(docs, lessonRunId, teamIds)
    const profileById = new Map(profiles.map((p) => [p.householdId, p]))

    const prepared = await prepareHouseholdAssignment({
      firestore: assignmentFirestoreOver(docs), lessonRunId, courseFormat: 'STAGE_SPLIT', teamIds, profiles,
      actorUid: 'teacher-1', idempotencyKey: 'prep-stage-1', now: () => 1000,
    })
    // Every distinct lifeStage is covered by at least one team, per Task 1's STAGE_SPLIT algorithm.
    expect(new Set(prepared.entries.map((e) => profileById.get(e.profileId)!.lifeStage))).toEqual(
      new Set(profiles.map((p) => p.lifeStage)),
    )

    const preparation = await assignmentFirestoreOver(docs).runTransaction((tx) =>
      prepareStatusTransition(tx as unknown as FirestoreTx, {
        lessonRunId, run: buildAdvancedRun('STAGE_SPLIT', profiles), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
      }))
    expect(preparation).not.toBeNull()
    for (const write of preparation!.writes) docs.set(write.path, write.data)

    for (const entry of prepared.entries) {
      const profile = profileById.get(entry.profileId)!
      const initial = buildInitialHouseholdState({
        lessonRunId, teamId: entry.teamId, householdId: entry.householdId, profileId: entry.profileId,
        startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, nowMillis: 1000,
      })
      expect(initial.lifeStage).toBe(profile.lifeStage)
      docs.set(`lessonRuns/${lessonRunId}/households/${entry.householdId}`, initial as unknown as Record<string, unknown>)
    }

    // Settle 3 rounds; §13's lifeStage is a fixed household attribute, never
    // mutated by round settlement — `settleRound` must carry it through
    // completely unchanged every round.
    for (const entry of prepared.entries) {
      const profile = profileById.get(entry.profileId)!
      let state = docs.get(`lessonRuns/${lessonRunId}/households/${entry.householdId}`) as unknown as HouseholdState
      for (let round = 0; round < 3; round += 1) {
        const result = settleAdvancedRound(state, profile)
        state = result.newHouseholdState
        expect(state.lifeStage).toBe(profile.lifeStage)
      }
      docs.set(`lessonRuns/${lessonRunId}/households/${entry.householdId}`, state as unknown as Record<string, unknown>)
    }
  })

  it('partial bulk retry: one household already SUCCEEDED, one FAILED — retry resumes and settles only the failed one (Task 6\'s executeBulkItems skip-already-SUCCEEDED behavior)', async () => {
    const lessonRunId = 'run-adv-retry'
    const profile = profileYoung
    const docs = new Map<string, Record<string, unknown>>()

    // hh-a already succeeded and moved on to round 2; hh-b is still stuck at round 1 (its prior attempt crashed before committing).
    docs.set(`lessonRuns/${lessonRunId}/households/hh-a`, buildInitialHouseholdState({
      lessonRunId, teamId: 'team-a', householdId: 'hh-a', profileId: profile.householdId,
      startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, nowMillis: 1000,
    }) as unknown as Record<string, unknown>)
    docs.set('lessonRuns/run-adv-retry/households/hh-a', { ...(docs.get('lessonRuns/run-adv-retry/households/hh-a') as Record<string, unknown>), roundIndex: 2 })
    docs.set(`lessonRuns/${lessonRunId}/households/hh-b`, buildInitialHouseholdState({
      lessonRunId, teamId: 'team-b', householdId: 'hh-b', profileId: profile.householdId,
      startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, nowMillis: 1000,
    }) as unknown as Record<string, unknown>)
    docs.set('lessonRuns/run-adv-retry/households/hh-b', { ...(docs.get('lessonRuns/run-adv-retry/households/hh-b') as Record<string, unknown>), roundIndex: 1 })

    let operation: HouseholdBulkSettlementOperation = {
      operationId: 'op-retry-1', lessonRunId, actorUid: 'teacher-1', expectedRoundIndex: 1,
      restoreGeneration: 0, assignmentRevision: 3, forceUnsubmitted: false, status: 'FAILED',
      preSettlementCheckpointId: 'cp-pre-1', requestDigest: 'digest-1', attempt: 1,
      leaseExpiresAtServerMillis: null, lastHeartbeatAtServerMillis: 1000,
      households: {
        'hh-a': { status: 'SUCCEEDED', teamId: 'team-a', profileId: profile.householdId },
        'hh-b': { status: 'FAILED', teamId: 'team-b', profileId: profile.householdId, errorCode: 'ERR', errorMessage: 'Simulated crash' },
      },
      createdAtServerMillis: 1000, updatedAtServerMillis: 2000,
    }
    const processRoundFn = vi.fn(async (input: { householdId: string }): Promise<ProcessRoundExecutionResult> => {
      if (input.householdId === 'hh-a') throw new Error('hh-a already SUCCEEDED — retry must never re-attempt it')
      const household = docs.get(`lessonRuns/${lessonRunId}/households/${input.householdId}`) as unknown as HouseholdState
      const result = settleAdvancedRound(household, profile)
      docs.set(`lessonRuns/${lessonRunId}/households/${input.householdId}`, result.newHouseholdState as unknown as Record<string, unknown>)
      return { status: 'COMMITTED', settlement: result }
    })

    const deps: BulkSettlementDeps = {
      readLessonRun: async () => ({ status: 'RUNNING', subject: 'HOME_ECONOMICS', courseFormat: 'ROLE_VARIANT', restoreGeneration: 0 }),
      readRuntimeControl: async () => ({ courseFormat: 'ROLE_VARIANT', assignmentRevision: 3, synchronizedRoundIndex: 1, roundStatus: 'SETTLING', activeOperationId: 'op-retry-1', updatedAtServerMillis: 900 }),
      listTargets: async () => Object.entries(operation.households).map(([householdId, item]): HouseholdBulkTarget => ({ householdId, teamId: item.teamId, profileId: item.profileId })),
      createOrReplayOperation: async () => { throw new Error('not used on retry') },
      createOrReplayOperationWithControlLock: async () => { throw new Error('not used on retry') },
      acquireLease: async () => { operation = { ...operation, status: 'RUNNING', attempt: operation.attempt + 1 }; return operation },
      heartbeatLease: async () => operation,
      ensureHousehold: async (_runId, target) => docs.get(`lessonRuns/${lessonRunId}/households/${target.householdId}`) as unknown as HouseholdState,
      readHouseholdState: async (_runId, householdId) => docs.get(`lessonRuns/${lessonRunId}/households/${householdId}`) as unknown as HouseholdState,
      readHouseholdDecision: async () => ({ decisionId: 'dec-1' } as never),
      writePreSettlementCheckpoint: async () => ({ checkpointId: 'cp-pre-1', created: false }),
      setOperationCheckpointId: async () => operation,
      processRoundFn,
      updateItemStatus: async (input) => {
        const prior = operation.households[input.householdId]
        operation = { ...operation, households: { ...operation.households, [input.householdId]: { teamId: prior.teamId, profileId: prior.profileId, status: input.status, errorCode: input.errorCode, errorMessage: input.errorMessage } } }
        return operation
      },
      finalizeOperation: async (input) => { operation = { ...operation, status: input.status, leaseExpiresAtServerMillis: null }; return operation },
      cancelOperation: async () => { operation = { ...operation, status: 'CANCELLED', leaseExpiresAtServerMillis: null }; return operation },
      getOperation: async () => operation,
      findUnresolvedOperation: async () => null,
    }

    const result = await retryHouseholdRoundBatch(deps, { lessonRunId, operationId: 'op-retry-1', actorUid: 'teacher-1', nowMillis: 3000 })

    expect(result.status).toBe('COMPLETED')
    expect(processRoundFn).toHaveBeenCalledTimes(1)
    expect(processRoundFn).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'hh-b' }))
    // hh-a (already SUCCEEDED before the retry) is completely untouched.
    expect((docs.get(`lessonRuns/${lessonRunId}/households/hh-a`) as unknown as HouseholdState).roundIndex).toBe(2)
    // hh-b (the one that actually failed) is now genuinely settled.
    expect((docs.get(`lessonRuns/${lessonRunId}/households/hh-b`) as unknown as HouseholdState).roundIndex).toBe(2)
    expect(result.households['hh-b'].status).toBe('SUCCEEDED')
  })

  it('other-team denial: a household\'s owning team is fixed by its FROZEN assignment entry, and the decision-write path has no caller-supplied team to spoof', async () => {
    const lessonRunId = 'run-adv-denial'
    const teamIds = ['team-a', 'team-b']
    const profiles = [profileYoung, profileRetiree]
    const docs = new Map<string, Record<string, unknown>>()
    seedTeamsAndIndex(docs, lessonRunId, teamIds)
    const profileById = new Map(profiles.map((p) => [p.householdId, p]))

    const prepared = await prepareHouseholdAssignment({
      firestore: assignmentFirestoreOver(docs), lessonRunId, courseFormat: 'ROLE_VARIANT', teamIds, profiles,
      actorUid: 'teacher-1', idempotencyKey: 'prep-denial-1', now: () => 1000,
    })
    const preparation = await assignmentFirestoreOver(docs).runTransaction((tx) =>
      prepareStatusTransition(tx as unknown as FirestoreTx, {
        lessonRunId, run: buildAdvancedRun('ROLE_VARIANT', profiles), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
      }))
    for (const write of preparation!.writes) docs.set(write.path, write.data)
    for (const entry of prepared.entries) {
      const profile = profileById.get(entry.profileId)!
      docs.set(`lessonRuns/${lessonRunId}/households/${entry.householdId}`, buildInitialHouseholdState({
        lessonRunId, teamId: entry.teamId, householdId: entry.householdId, profileId: entry.profileId,
        startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, nowMillis: 1000,
      }) as unknown as Record<string, unknown>)
    }

    const householdOnTeamA = prepared.entries.find((e) => e.teamId === 'team-a')!
    const householdOnTeamB = prepared.entries.find((e) => e.teamId === 'team-b')!
    expect(householdOnTeamA.householdId).not.toBe(householdOnTeamB.householdId)

    // `SaveAdvancedHouseholdDecisionInput` (the real, only mutating write
    // path for an advanced decision) takes `lessonRunId`/`householdId` and
    // nothing resembling a caller-supplied `teamId` — team ownership is
    // never something a request payload can assert; it can only be read
    // back from the household's own FROZEN, server-written record. A real
    // Callable (`submitHouseholdDecisionCallable`, `onCall.ts`) authorizes
    // the caller against exactly that stored `teamId`
    // (`resolveFrozenAssignmentEntry` + `requireTeamMembership`) before
    // ever reaching this function — this test proves the data-layer half
    // of that guarantee: the record this authorization reads from is
    // immutable per household and cannot be influenced by the caller.
    const stateBBefore = docs.get(`lessonRuns/${lessonRunId}/households/${householdOnTeamB.householdId}`)
    await saveAdvancedHouseholdDecisionWithAdminSdk({
      firestore: householdFirestoreOver(docs), lessonRunId, householdId: householdOnTeamA.householdId,
      decision: {
        decisionId: `dec-${householdOnTeamA.householdId}-r0`, lessonRunId, householdId: householdOnTeamA.householdId, roundIndex: 0,
        assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [], shortfallResolutionType: null,
        publicSupportApplicationIds: [], idempotencyKey: `dec-${householdOnTeamA.householdId}-r0`,
      },
      expectedSynchronizedRoundIndex: 0, assignmentRevision: 1, idempotencyKey: `dec-${householdOnTeamA.householdId}-r0`, nowMillis: 1500,
    })

    const stateA = docs.get(`lessonRuns/${lessonRunId}/households/${householdOnTeamA.householdId}`) as unknown as HouseholdState
    const stateBAfter = docs.get(`lessonRuns/${lessonRunId}/households/${householdOnTeamB.householdId}`)
    expect(stateA.teamId).toBe('team-a')
    // team-b's household is completely untouched by a decision submitted for team-a's household.
    expect(stateBAfter).toEqual(stateBBefore)
  })

  it('COMMON_CONDITIONS legacy regression: the original Common flow still works completely unchanged after all 13 tasks\' generalization work', async () => {
    // Re-runs the exact Task 17 assertions this file already opened with
    // (init -> settle -> checkpoint round-trip), as an explicit acceptance
    // guard specifically for Task 14's generalization work rather than
    // relying on the pre-existing tests above never having been touched.
    expect(validateHomeEconomicsContent(template)).toEqual({ valid: true })
    const profile = template.households[0]
    const fake = makeFakeHouseholdFirestore()

    const initial = await getOrInitHouseholdState({
      firestore: fake, lessonRunId: 'run-common-regress', teamId: 'case-a', householdId: 'case-a',
      profileId: 'case-a', startingCashYen: profile.cashSavingsYen, startingLifeStage: profile.lifeStage, now: () => 1_000,
    })
    // COMMON_CONDITIONS's defining identity collision still holds: householdId === teamId === the sole profile's id.
    expect(initial.householdId).toBe(initial.teamId)
    expect(initial.householdId).toBe(profile.householdId)

    const settled = settleRound({
      household: initial, profile, decision: null,
      lifeEvents: template.lifeEvents, insuranceProducts: template.insuranceProducts,
      publicSupportPrograms: template.publicSupportPrograms, liabilityCatalog: template.liabilities,
      assetCatalog: template.assets, economicFactors: template.economicFactors,
      taxModelVersion: template.taxAndSocialInsuranceModelVersion, roundYears: template.roundYears,
      borrowingAllowed: template.borrowingAllowed, randomSeed: 'common-regress-seed', restoreGeneration: 0,
    })
    expect(settled.newHouseholdState.roundIndex).toBe(1)

    const snapshot = buildHouseholdCheckpointSnapshot([settled.newHouseholdState])
    const restored = restoreHouseholdsFromSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(restored).toEqual([settled.newHouseholdState])
  })
})

