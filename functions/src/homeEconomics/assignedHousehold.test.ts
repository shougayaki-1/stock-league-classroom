import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrInitAssignedHouseholdState } from './assignedHousehold'
import type { HouseholdState } from '../lessonRuns/households/repository'

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

describe('getOrInitAssignedHouseholdState', () => {
  it('creates a household document stamped with profileId/teamId from the frozen assignment entry', async () => {
    const fake = makeFakeFirestore()
    const state = await getOrInitAssignedHouseholdState({
      firestore: fake as never,
      lessonRunId: 'run-1',
      householdId: 'household-runtime-1',
      teamId: 'team-a',
      profileId: 'profile-role-1',
      startingCashYen: 2500000,
      startingLifeStage: 'INDEPENDENT',
      now: () => 5000,
    })
    expect(state).toMatchObject({
      householdId: 'household-runtime-1',
      teamId: 'team-a',
      profileId: 'profile-role-1',
      cashYen: 2500000,
      lifeStage: 'INDEPENDENT',
      roundIndex: 0,
    })
    expect(fake.docs.get('lessonRuns/run-1/households/household-runtime-1')).toBeDefined()
  })

  it('is idempotent — returns the existing document unchanged when teamId/profileId match', async () => {
    const fake = makeFakeFirestore()
    const existing: HouseholdState = {
      householdId: 'household-runtime-1', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'profile-role-1',
      cashYen: 999999, assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'CHILD_REARING', roundIndex: 2, goalDelayedRounds: 0, updatedAtServerMillis: 10,
    }
    fake.docs.set('lessonRuns/run-1/households/household-runtime-1', existing as unknown as Record<string, unknown>)

    const state = await getOrInitAssignedHouseholdState({
      firestore: fake as never,
      lessonRunId: 'run-1',
      householdId: 'household-runtime-1',
      teamId: 'team-a',
      profileId: 'profile-role-1',
      startingCashYen: 1,
      startingLifeStage: 'INDEPENDENT',
      now: () => 6000,
    })
    expect(state.cashYen).toBe(999999)
    expect(state.roundIndex).toBe(2)
  })

  it('throws when an existing document\'s persisted teamId/profileId does not match the frozen assignment entry', async () => {
    const fake = makeFakeFirestore()
    const existing: HouseholdState = {
      householdId: 'household-runtime-1', lessonRunId: 'run-1', teamId: 'team-WRONG', profileId: 'profile-role-1',
      cashYen: 0, assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'INDEPENDENT', roundIndex: 0, goalDelayedRounds: 0, updatedAtServerMillis: 0,
    }
    fake.docs.set('lessonRuns/run-1/households/household-runtime-1', existing as unknown as Record<string, unknown>)

    await expect(getOrInitAssignedHouseholdState({
      firestore: fake as never,
      lessonRunId: 'run-1',
      householdId: 'household-runtime-1',
      teamId: 'team-a',
      profileId: 'profile-role-1',
      startingCashYen: 0,
      startingLifeStage: 'INDEPENDENT',
      now: () => 0,
    })).rejects.toThrow(/does not match/)
  })

  it('throws when an existing document\'s persisted profileId does not match the frozen assignment entry', async () => {
    const fake = makeFakeFirestore()
    const existing: HouseholdState = {
      householdId: 'household-runtime-1', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'profile-WRONG',
      cashYen: 0, assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'INDEPENDENT', roundIndex: 0, goalDelayedRounds: 0, updatedAtServerMillis: 0,
    }
    fake.docs.set('lessonRuns/run-1/households/household-runtime-1', existing as unknown as Record<string, unknown>)

    await expect(getOrInitAssignedHouseholdState({
      firestore: fake as never,
      lessonRunId: 'run-1',
      householdId: 'household-runtime-1',
      teamId: 'team-a',
      profileId: 'profile-role-1',
      startingCashYen: 0,
      startingLifeStage: 'INDEPENDENT',
      now: () => 0,
    })).rejects.toThrow(/does not match/)
  })
})

// -----------------------------------------------------------------------------
// Exercises `ensureAssignedHouseholdStateWithAdminSdk` directly — no injected
// dependency seam (it calls getFirestore() itself, matching every other
// *WithAdminSdk function in this codebase), so a module-level
// vi.mock('firebase-admin/firestore', ...) is the established way to test it
// without a real emulator (same precedent as
// `processRound.test.ts`'s `readLessonRunConfigWithAdminSdk` tests).
// -----------------------------------------------------------------------------
const docs = new Map<string, Record<string, unknown>>()
const collections = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      path,
      get: async () => ({
        exists: docs.has(path),
        data: () => docs.get(path),
        get: (field: string) => (docs.get(path) as Record<string, unknown> | undefined)?.[field],
      }),
    }),
    collection: (path: string) => ({
      get: async () => ({
        docs: (collections.get(path) ?? []).map((entry) => ({ id: entry.id, data: () => entry.data })),
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
      set: (ref: { path: string }, data: Record<string, unknown>) => { docs.set(ref.path, data) },
    }),
  }),
}))

beforeEach(() => {
  docs.clear()
  collections.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

const homeEconomicsSnapshot = {
  courseFormat: 'ROLE_VARIANT',
  households: [
    {
      householdId: 'profile-role-1', age: 40, family: '配偶者', housing: '持ち家', lifeGoal: '老後資金',
      lifeStage: 'CHILD_REARING', cashSavingsYen: 3000000, householdIncomeYen: 5000000,
      annualLivingExpensesYen: 3500000, eventProbabilityOverrides: {}, internalRiskFactors: {},
    },
  ],
  assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [], publicSupportPrograms: [],
  roundYears: 5, economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
  borrowingAllowed: false, taxAndSocialInsuranceModelVersion: 1, goalPackage: 'OVERALL_BALANCE',
  evaluationWeights: {
    lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
  },
}

const setLessonRun = () => {
  docs.set('lessonRuns/run-1', { templateSnapshot: { homeEconomics: homeEconomicsSnapshot } })
}

const setConfig = (state: 'DRAFT' | 'STALE' | 'FROZEN') => {
  docs.set('lessonRuns/run-1/householdAssignment/config', {
    courseFormat: 'ROLE_VARIANT', state, validationStatus: 'READY', assignmentRevision: 1,
    teamSetFingerprint: 'fp-1', entryIds: ['household-runtime-1'], entriesDigest: 'digest-1',
    lastEditedByUid: 'teacher-a', lastEditedAtServerMillis: 0,
  })
}

const setEntries = (entries: Array<{ householdId: string; teamId: string; profileId: string }>) => {
  collections.set('lessonRuns/run-1/householdAssignment/config/entries', entries.map((entry) => ({
    id: entry.householdId,
    data: { ...entry, slotKey: entry.profileId, displayOrder: 0, assignmentSource: 'AUTO' as const },
  })))
}

describe('ensureAssignedHouseholdStateWithAdminSdk', () => {
  it('throws when no HouseholdAssignmentConfig has been prepared', async () => {
    const { ensureAssignedHouseholdStateWithAdminSdk } = await import('./assignedHousehold')
    await expect(ensureAssignedHouseholdStateWithAdminSdk('run-1', 'household-runtime-1'))
      .rejects.toThrow('has not been prepared')
  })

  it('throws when the assignment exists but is not FROZEN', async () => {
    setConfig('DRAFT')
    setEntries([{ householdId: 'household-runtime-1', teamId: 'team-a', profileId: 'profile-role-1' }])
    const { ensureAssignedHouseholdStateWithAdminSdk } = await import('./assignedHousehold')
    await expect(ensureAssignedHouseholdStateWithAdminSdk('run-1', 'household-runtime-1'))
      .rejects.toThrow('must be FROZEN')
  })

  it('throws when no frozen entry matches the given runtime householdId', async () => {
    setConfig('FROZEN')
    setEntries([{ householdId: 'some-other-household', teamId: 'team-a', profileId: 'profile-role-1' }])
    const { ensureAssignedHouseholdStateWithAdminSdk } = await import('./assignedHousehold')
    await expect(ensureAssignedHouseholdStateWithAdminSdk('run-1', 'household-runtime-1'))
      .rejects.toThrow('No frozen HouseholdAssignmentEntry')
  })

  it('creates the HouseholdState using the frozen entry\'s teamId/profileId and the matching profile\'s starting values', async () => {
    setConfig('FROZEN')
    setEntries([{ householdId: 'household-runtime-1', teamId: 'team-a', profileId: 'profile-role-1' }])
    setLessonRun()

    const { ensureAssignedHouseholdStateWithAdminSdk } = await import('./assignedHousehold')
    const state = await ensureAssignedHouseholdStateWithAdminSdk('run-1', 'household-runtime-1')

    expect(state).toMatchObject({
      householdId: 'household-runtime-1', teamId: 'team-a', profileId: 'profile-role-1',
      cashYen: 3000000, lifeStage: 'CHILD_REARING', roundIndex: 0,
    })
    expect(docs.get('lessonRuns/run-1/households/household-runtime-1')).toBeDefined()
  })

  it('is idempotent — a second call returns the already-created document', async () => {
    setConfig('FROZEN')
    setEntries([{ householdId: 'household-runtime-1', teamId: 'team-a', profileId: 'profile-role-1' }])
    setLessonRun()

    const { ensureAssignedHouseholdStateWithAdminSdk } = await import('./assignedHousehold')
    const first = await ensureAssignedHouseholdStateWithAdminSdk('run-1', 'household-runtime-1')
    const second = await ensureAssignedHouseholdStateWithAdminSdk('run-1', 'household-runtime-1')
    expect(second).toEqual(first)
  })

  it('throws when the profileId on the frozen entry has no matching HouseholdProfile in the template snapshot', async () => {
    setConfig('FROZEN')
    setEntries([{ householdId: 'household-runtime-1', teamId: 'team-a', profileId: 'profile-does-not-exist' }])
    setLessonRun()

    const { ensureAssignedHouseholdStateWithAdminSdk } = await import('./assignedHousehold')
    await expect(ensureAssignedHouseholdStateWithAdminSdk('run-1', 'household-runtime-1'))
      .rejects.toThrow('HouseholdProfile not found in template snapshot')
  })
})
