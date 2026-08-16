import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import {
  buildInitialHouseholdState,
  getOrInitHouseholdState,
  resolveStoredHouseholdState,
  saveAdvancedHouseholdDecisionWithAdminSdk,
  saveHouseholdDecision,
  type HouseholdDecisionRecord,
  type StoredHouseholdState,
} from './repository'
import type { HouseholdRuntimeControl } from '../../homeEconomics/statusTransition'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    // `written` is scoped to a single `runTransaction` call, matching real
    // Firestore semantics (read-after-write is forbidden WITHIN one
    // transaction attempt, not across separate transactions issued later
    // by the same fake) — needed so tests below can call
    // `saveHouseholdDecision` more than once against the same fake to
    // exercise its idempotency behavior across calls.
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const written = new Set<string>()
      return fn({
        get: async (path: string) => {
          if (written.has(path)) throw new Error(`read-after-write violation: ${path}`)
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { docs.set(path, data); written.add(path) },
      })
    },
  }
}

describe('buildInitialHouseholdState', () => {
  it('returns clean initial HouseholdState matching canonical contract', () => {
    const state = buildInitialHouseholdState({
      lessonRunId: 'run-1',
      teamId: 'team-a',
      householdId: 'house-a',
      profileId: 'profile-a',
      startingCashYen: 2000000,
      startingLifeStage: 'CHILD_REARING',
      nowMillis: 1000,
    })
    expect(state).toEqual({
      householdId: 'house-a',
      lessonRunId: 'run-1',
      teamId: 'team-a',
      profileId: 'profile-a',
      cashYen: 2000000,
      assetHoldingsYen: {},
      activeInsuranceContracts: {},
      activeLiabilities: {},
      lifeStage: 'CHILD_REARING',
      roundIndex: 0,
      goalDelayedRounds: 0,
      updatedAtServerMillis: 1000,
    })
  })
})

describe('getOrInitHouseholdState', () => {
  it('creates a fresh state with the profile\'s starting cash on first access', async () => {
    const fake = makeFakeFirestore()
    const state = await getOrInitHouseholdState({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a', householdId: 'case-b', profileId: 'profile-b',
      startingCashYen: 2000000, startingLifeStage: 'CHILD_REARING', now: () => 1,
    })
    expect(state).toMatchObject({ cashYen: 2000000, lifeStage: 'CHILD_REARING', roundIndex: 0, goalDelayedRounds: 0, profileId: 'profile-b' })
  })

  it('returns the existing state unchanged on a later access, ignoring startingCashYen', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/households/case-b', {
      householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'profile-b', cashYen: 500000,
      assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'INDEPENDENT', roundIndex: 3, goalDelayedRounds: 1, updatedAtServerMillis: 0,
    })
    const state = await getOrInitHouseholdState({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a', householdId: 'case-b', profileId: 'profile-b',
      startingCashYen: 999999999, startingLifeStage: 'CHILD_REARING', now: () => 2,
    })
    expect(state.cashYen).toBe(500000)
    expect(state.roundIndex).toBe(3)
  })
})

describe('resolveStoredHouseholdState', () => {
  const commonContent: HomeEconomicsContent = {
    courseFormat: 'COMMON_CONDITIONS',
    households: [
      {
        householdId: 'profile-1', age: 30, family: '単身', housing: '賃貸', lifeGoal: '貯蓄',
        lifeStage: 'INDEPENDENT', cashSavingsYen: 1500000, householdIncomeYen: 3000000,
        annualLivingExpensesYen: 2000000, eventProbabilityOverrides: {}, internalRiskFactors: {},
      },
    ],
    assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [], publicSupportPrograms: [],
    roundYears: 5, economicFactors: { inflationPercent: 1, interestRatePercent: 0.1, marketReturnPercent: 2 },
    borrowingAllowed: false, taxAndSocialInsuranceModelVersion: 1, goalPackage: 'OVERALL_BALANCE',
    evaluationWeights: {
      lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
    },
  }
  const roleVariantContent: HomeEconomicsContent = { ...commonContent, courseFormat: 'ROLE_VARIANT' }

  const baseStored = (profileId?: string): StoredHouseholdState => ({
    householdId: 'household-runtime-1', lessonRunId: 'run-1', teamId: 'team-a',
    ...(profileId !== undefined ? { profileId } : {}),
    cashYen: 100, assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
    lifeStage: 'INDEPENDENT', roundIndex: 0, goalDelayedRounds: 0, updatedAtServerMillis: 0,
  })

  it('passes an already-present profileId through unchanged', () => {
    const stored = baseStored('profile-explicit')
    const resolved = resolveStoredHouseholdState({ stored, content: commonContent })
    expect(resolved.profileId).toBe('profile-explicit')
  })

  it('infers profileId as the sole profile for legacy COMMON_CONDITIONS documents missing it', () => {
    const stored = baseStored(undefined)
    const resolved = resolveStoredHouseholdState({ stored, content: commonContent })
    expect(resolved.profileId).toBe('profile-1')
    expect(resolved).toMatchObject({ householdId: 'household-runtime-1', teamId: 'team-a' })
  })

  it('fails closed when profileId is missing under an advanced course format', () => {
    const stored = baseStored(undefined)
    expect(() => resolveStoredHouseholdState({ stored, content: roleVariantContent })).toThrow(/profileId/)
  })

  it('fails closed for COMMON_CONDITIONS with missing profileId when the template does not have exactly one profile', () => {
    const stored = baseStored(undefined)
    const multiProfileContent: HomeEconomicsContent = {
      ...commonContent,
      households: [commonContent.households[0], { ...commonContent.households[0], householdId: 'profile-2' }],
    }
    expect(() => resolveStoredHouseholdState({ stored, content: multiProfileContent })).toThrow(/profileId/)
  })
})

describe('saveHouseholdDecision', () => {
  const baseInput = {
    lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
    assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
    shortfallResolutionType: null as null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
    now: () => 42,
  }

  it('creates a decision on first submission', async () => {
    const fake = makeFakeFirestore()
    const result = await saveHouseholdDecision({ firestore: fake as never, ...baseInput })
    expect(result.created).toBe(true)
    expect(result.decisionId).toBeTruthy()
  })

  it('is idempotent for a repeated (lessonRunId, householdId, roundIndex, idempotencyKey) with the same payload', async () => {
    const fake = makeFakeFirestore()
    const first = await saveHouseholdDecision({ firestore: fake as never, ...baseInput })
    const second = await saveHouseholdDecision({ firestore: fake as never, ...baseInput })
    expect(second.created).toBe(false)
    expect(second.decisionId).toBe(first.decisionId)
  })

  it('rejects the same idempotencyKey replayed with a materially different payload', async () => {
    const fake = makeFakeFirestore()
    await saveHouseholdDecision({ firestore: fake as never, ...baseInput })
    await expect(saveHouseholdDecision({
      firestore: fake as never, ...baseInput, assetAllocationChangesYen: { DOMESTIC_STOCK: 999 },
    })).rejects.toThrow('Idempotency key payload mismatch')
  })

  // Review finding (Important #2): `voluntaryDrawdownRequestedYen` is
  // included in `requestDigest` (see `saveHouseholdDecision` above), but
  // that was only covered transitively by other tests — this proves
  // replaying the same key with a different `voluntaryDrawdownRequestedYen`
  // is rejected, same as any other digest-relevant field.
  it('rejects the same idempotencyKey replayed with a different voluntaryDrawdownRequestedYen', async () => {
    const fake = makeFakeFirestore()
    await saveHouseholdDecision({ firestore: fake as never, ...baseInput, voluntaryDrawdownRequestedYen: 100 })
    await expect(saveHouseholdDecision({
      firestore: fake as never, ...baseInput, voluntaryDrawdownRequestedYen: 200,
    })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('scopes idempotency per roundIndex — the same key on a different round creates a separate decision', async () => {
    const fake = makeFakeFirestore()
    const round3 = await saveHouseholdDecision({ firestore: fake as never, ...baseInput })
    const round4 = await saveHouseholdDecision({ firestore: fake as never, ...baseInput, roundIndex: 4 })
    expect(round4.created).toBe(true)
    expect(round4.decisionId).not.toBe(round3.decisionId)
  })
})

describe('saveAdvancedHouseholdDecisionWithAdminSdk', () => {
  const controlPath = 'lessonRuns/run-1/householdRuntime/control'
  const householdPath = 'lessonRuns/run-1/households/case-b'

  const baseControl: HouseholdRuntimeControl = {
    courseFormat: 'ROLE_VARIANT', assignmentRevision: 1, synchronizedRoundIndex: 3,
    roundStatus: 'OPEN', activeOperationId: null, updatedAtServerMillis: 0,
  }

  const baseHousehold = {
    householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'profile-a', cashYen: 500000,
    assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
    lifeStage: 'INDEPENDENT', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
  }

  const baseDecision: Omit<HouseholdDecisionRecord, 'submittedAtServerMillis'> = {
    decisionId: 'run-1_decision_abc123', lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
    assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
    shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
  }

  const seedReady = (fake: ReturnType<typeof makeFakeFirestore>): void => {
    fake.docs.set(controlPath, baseControl as unknown as Record<string, unknown>)
    fake.docs.set(householdPath, baseHousehold)
  }

  const baseInput = {
    lessonRunId: 'run-1', householdId: 'case-b', decision: baseDecision,
    expectedSynchronizedRoundIndex: 3, assignmentRevision: 1, idempotencyKey: 'key-1', nowMillis: 42,
  }

  it('creates a decision on first submission, stamping submittedAtServerMillis from nowMillis', async () => {
    const fake = makeFakeFirestore()
    seedReady(fake)
    const record = await saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput })
    expect(record).toMatchObject({ decisionId: 'run-1_decision_abc123', roundIndex: 3, submittedAtServerMillis: 42 })
  })

  it('is idempotent for a repeated idempotencyKey with the same payload, returning the original record', async () => {
    const fake = makeFakeFirestore()
    seedReady(fake)
    const first = await saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput })
    const second = await saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput })
    expect(second).toEqual(first)
  })

  it('rejects the same idempotencyKey replayed with a materially different payload', async () => {
    const fake = makeFakeFirestore()
    seedReady(fake)
    await saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput })
    await expect(saveAdvancedHouseholdDecisionWithAdminSdk({
      firestore: fake as never, ...baseInput,
      decision: { ...baseDecision, assetAllocationChangesYen: { DOMESTIC_STOCK: 999 } },
    })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('a replay short-circuits before re-checking roundStatus/assignmentRevision/round consistency', async () => {
    const fake = makeFakeFirestore()
    seedReady(fake)
    const first = await saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput })
    // Mutate the control doc directly (bypassing the transaction) to simulate
    // the round having moved on since the original submission.
    fake.docs.set(controlPath, { ...baseControl, roundStatus: 'SETTLING' } as unknown as Record<string, unknown>)
    const second = await saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput })
    expect(second).toEqual(first)
  })

  it('rejects when the HouseholdRuntimeControl document does not exist', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set(householdPath, baseHousehold)
    await expect(saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput }))
      .rejects.toThrow('HouseholdRuntimeControl not found')
  })

  it('rejects when the HouseholdState document does not exist', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set(controlPath, baseControl as unknown as Record<string, unknown>)
    await expect(saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput }))
      .rejects.toThrow('HouseholdState not found')
  })

  it('rejects when roundStatus is SETTLING (a bulk settlement is in progress)', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set(controlPath, { ...baseControl, roundStatus: 'SETTLING' } as unknown as Record<string, unknown>)
    fake.docs.set(householdPath, baseHousehold)
    await expect(saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput }))
      .rejects.toThrow('HouseholdRuntimeControl round is not OPEN')
  })

  it('rejects when the control document\'s assignmentRevision does not match the caller\'s expected assignmentRevision', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set(controlPath, { ...baseControl, assignmentRevision: 2 } as unknown as Record<string, unknown>)
    fake.docs.set(householdPath, baseHousehold)
    await expect(saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput }))
      .rejects.toThrow('assignmentRevision does not match')
  })

  it('rejects when the HouseholdState\'s own roundIndex has drifted from the control document\'s synchronizedRoundIndex', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set(controlPath, baseControl as unknown as Record<string, unknown>)
    fake.docs.set(householdPath, { ...baseHousehold, roundIndex: 4 })
    await expect(saveAdvancedHouseholdDecisionWithAdminSdk({ firestore: fake as never, ...baseInput }))
      .rejects.toThrow('HouseholdState roundIndex does not match HouseholdRuntimeControl synchronizedRoundIndex')
  })

  it('rejects when the caller\'s expectedSynchronizedRoundIndex no longer matches the control document\'s synchronizedRoundIndex (round moved on)', async () => {
    const fake = makeFakeFirestore()
    seedReady(fake)
    await expect(saveAdvancedHouseholdDecisionWithAdminSdk({
      firestore: fake as never, ...baseInput, expectedSynchronizedRoundIndex: 2,
    })).rejects.toThrow('Requested round no longer matches the synchronized round')
  })
})
