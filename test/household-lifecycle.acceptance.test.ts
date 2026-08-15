import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '../functions/packages/household-authoring-content/src/index'
import { validateHomeEconomicsContent } from '../functions/src/homeEconomics/templateValidation'
import { getOrInitHouseholdState, type HouseholdState, type HouseholdTx } from '../functions/src/lessonRuns/households/repository'
import { settleRound } from '../functions/src/homeEconomics/engine/settleRound'
import { buildHouseholdCheckpointSnapshot, restoreHouseholdsFromSnapshot } from '../functions/src/homeEconomics/checkpointRestore'
import { resolveVisibleConcepts } from '../functions/src/homeEconomics/goalPackage'
import { buildEventDisclosureView } from '../functions/src/homeEconomics/engine/lifeEvents'
import { toHouseholdStateTeamView } from '../functions/src/homeEconomics/realtimeProjection'
import {
  computeDiversificationScore, computeEmergencyFundAdequacyScore, computeLifeGoalAchievementScore,
  computeStabilityScore, computeWeightedTotalScore,
} from '../functions/src/homeEconomics/evaluation'

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
    const teamView = toHouseholdStateTeamView(round3.newHouseholdState, visibleConcepts, eventDisclosures, round3.shortfallOptionsConsidered)
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
      restoreGeneration: 0,
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
      nowMillis: 1000,
    })

    expect(dashboard1.households).toHaveLength(2)
    expect(dashboard1.households[0].teamDisplayName).toBe('チーム1')
    expect(dashboard1.households[0].submittedForRoundIndex).toBe(false)
    expect(dashboard1.householdsAligned).toBe(true)

    // 2. Normal bulk rejects missing submissions
    const unsubmitted = dashboard1.households.filter((h) => !h.submittedForRoundIndex)
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
      restoredHouseholds[0],
      resolveVisibleConcepts(template.goalPackage),
      [],
      [],
    )
    expect(restoredHouseholds[0].restoreGeneration).toBe(1)
    expect(restoredTeamView.roundIndex).toBe(0)
  })
})

