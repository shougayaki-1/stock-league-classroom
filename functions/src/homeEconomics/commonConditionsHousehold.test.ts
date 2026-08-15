import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import {
  ensureCommonConditionsHouseholdState,
  previewCommonConditionsHouseholdState,
  resolveCommonConditionsProfile,
} from './commonConditionsHousehold'
import type { HouseholdState } from '../lessonRuns/households/repository'

const makeValidCommonConditionsContent = (): HomeEconomicsContent => ({
  courseFormat: 'COMMON_CONDITIONS',
  households: [
    {
      householdId: 'profile-1',
      age: 30,
      family: '単身',
      housing: '賃貸',
      lifeGoal: '貯蓄',
      lifeStage: 'INDEPENDENT',
      cashSavingsYen: 1500000,
      householdIncomeYen: 3000000,
      annualLivingExpensesYen: 2000000,
      eventProbabilityOverrides: {},
      internalRiskFactors: {},
    },
  ],
  assets: [],
  insuranceProducts: [],
  lifeEvents: [],
  liabilities: [],
  publicSupportPrograms: [],
  roundYears: 5,
  economicFactors: {
    inflationPercent: 1,
    interestRatePercent: 0.1,
    marketReturnPercent: 2,
  },
  borrowingAllowed: false,
  taxAndSocialInsuranceModelVersion: 1,
  goalPackage: 'OVERALL_BALANCE',
  evaluationWeights: {
    lifeGoalAchievement: 1,
    emergencyFundAdequacy: 0,
    stability: 0,
    diversification: 0,
    borrowingBurden: 0,
    reflection: 0,
  },
})

describe('resolveCommonConditionsProfile', () => {
  it('resolves the single profile for valid COMMON_CONDITIONS content', () => {
    const content = makeValidCommonConditionsContent()
    const profile = resolveCommonConditionsProfile(content)
    expect(profile.householdId).toBe('profile-1')
    expect(profile.cashSavingsYen).toBe(1500000)
  })

  it('throws for non-COMMON_CONDITIONS format', () => {
    const content = { ...makeValidCommonConditionsContent(), courseFormat: 'ROLE_VARIANT' as const }
    expect(() => resolveCommonConditionsProfile(content)).toThrow('共通条件モード')
  })

  it('throws for COMMON_CONDITIONS with 0 or multiple profiles', () => {
    const contentNoHouseholds = { ...makeValidCommonConditionsContent(), households: [] }
    expect(() => resolveCommonConditionsProfile(contentNoHouseholds)).toThrow('共通条件モード')

    const contentMultiHouseholds = {
      ...makeValidCommonConditionsContent(),
      households: [makeValidCommonConditionsContent().households[0], makeValidCommonConditionsContent().households[0]],
    }
    expect(() => resolveCommonConditionsProfile(contentMultiHouseholds)).toThrow('共通条件モード')
  })
})

describe('previewCommonConditionsHouseholdState', () => {
  it('builds an in-memory HouseholdState without writing to database', () => {
    const content = makeValidCommonConditionsContent()
    const state = previewCommonConditionsHouseholdState({
      lessonRunId: 'run-1',
      teamId: 'team-xyz',
      content,
      nowMillis: 5000,
    })
    expect(state).toEqual({
      householdId: 'team-xyz',
      lessonRunId: 'run-1',
      teamId: 'team-xyz',
      cashYen: 1500000,
      assetHoldingsYen: {},
      activeInsuranceContracts: {},
      activeLiabilities: {},
      lifeStage: 'INDEPENDENT',
      roundIndex: 0,
      goalDelayedRounds: 0,
      updatedAtServerMillis: 5000,
    })
  })
})

describe('ensureCommonConditionsHouseholdState', () => {
  const makeFakeFirestore = () => {
    const docs = new Map<string, Record<string, unknown>>()
    return {
      docs,
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

  it('creates household document if it does not exist', async () => {
    const fake = makeFakeFirestore()
    const content = makeValidCommonConditionsContent()
    const state = await ensureCommonConditionsHouseholdState({
      firestore: fake as never,
      lessonRunId: 'run-1',
      teamId: 'team-1',
      content,
      now: () => 9000,
    })
    expect(state.householdId).toBe('team-1')
    expect(state.cashYen).toBe(1500000)
    expect(fake.docs.get('lessonRuns/run-1/households/team-1')).toBeDefined()
  })

  it('returns existing household unchanged if already created', async () => {
    const fake = makeFakeFirestore()
    const existing: HouseholdState = {
      householdId: 'team-1',
      lessonRunId: 'run-1',
      teamId: 'team-1',
      cashYen: 888888,
      assetHoldingsYen: {},
      activeInsuranceContracts: {},
      activeLiabilities: {},
      lifeStage: 'CHILD_REARING',
      roundIndex: 2,
      goalDelayedRounds: 0,
      updatedAtServerMillis: 1000,
    }
    fake.docs.set('lessonRuns/run-1/households/team-1', existing as unknown as Record<string, unknown>)

    const content = makeValidCommonConditionsContent()
    const state = await ensureCommonConditionsHouseholdState({
      firestore: fake as never,
      lessonRunId: 'run-1',
      teamId: 'team-1',
      content,
      now: () => 9000,
    })
    expect(state.cashYen).toBe(888888)
    expect(state.roundIndex).toBe(2)
  })
})
