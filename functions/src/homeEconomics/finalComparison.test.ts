import { describe, expect, it } from 'vitest'
import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import type { HouseholdState } from '../lessonRuns/households/repository'
import {
  buildHouseholdClassComparisonPublicView,
  evaluateHouseholdReflectionGate,
  hasUnresolvedBulkSettlementOperationInTransaction,
  householdFinalComparisonPath,
} from './finalComparison'
import type { HouseholdAssignmentEntry } from './householdAssignment'

const profileA: HouseholdProfile = {
  householdId: 'profile-a', age: 30, householdIncomeYen: 5000000, annualLivingExpensesYen: 3000000,
  cashSavingsYen: 1000000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄', lifeStage: 'INDEPENDENT',
  eventProbabilityOverrides: { 'event-1': 0.42 }, internalRiskFactors: { health: 0.7 },
}
const profileB: HouseholdProfile = {
  householdId: 'profile-b', age: 40, householdIncomeYen: 7000000, annualLivingExpensesYen: 4000000,
  cashSavingsYen: 2000000, family: '配偶者・子1人', housing: '持ち家', lifeGoal: '教育資金', lifeStage: 'CHILD_REARING',
  eventProbabilityOverrides: { 'event-2': 0.13 }, internalRiskFactors: { income: 0.2 },
}

const entry = (teamId: string, profileId: string, householdId: string, displayOrder: number): HouseholdAssignmentEntry => ({
  householdId, teamId, profileId, slotKey: profileId, displayOrder, assignmentSource: 'AUTO',
})

const state = (overrides: Partial<HouseholdState> = {}): HouseholdState => ({
  householdId: 'team-a:profile-a', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'profile-a',
  cashYen: 1000000, assetHoldingsYen: { DOMESTIC_STOCK: 500000, FOREIGN_STOCK: 200000 },
  activeInsuranceContracts: {},
  activeLiabilities: { loan1: { remainingPrincipalYen: 300000, remainingYears: 5, annualInterestRatePercent: 2 } },
  lifeStage: 'INDEPENDENT', roundIndex: 6, goalDelayedRounds: 1, updatedAtServerMillis: 1,
  ...overrides,
})

describe('householdFinalComparisonPath', () => {
  it('matches the brief-given persistence path', () => {
    expect(householdFinalComparisonPath('run-1')).toBe('lessonRuns/run-1/householdFinalComparison/result')
  })
})

describe('evaluateHouseholdReflectionGate', () => {
  const base = {
    roundStatus: 'OPEN' as const, activeOperationId: null, synchronizedRoundIndex: 6,
    hasUnresolvedBulkOperation: false, householdRoundIndices: [6, 6, 6],
  }

  it('returns null (safe to proceed) when every condition is clean', () => {
    expect(evaluateHouseholdReflectionGate(base)).toBeNull()
  })

  it('rejects when roundStatus is SETTLING', () => {
    expect(evaluateHouseholdReflectionGate({ ...base, roundStatus: 'SETTLING' })).toMatch(/SETTLING/)
  })

  it('rejects when there is an active operation lock', () => {
    expect(evaluateHouseholdReflectionGate({ ...base, activeOperationId: 'op-1' })).toMatch(/locked/)
  })

  it('rejects when synchronizedRoundIndex is 0 (no completed round yet)', () => {
    expect(evaluateHouseholdReflectionGate({ ...base, synchronizedRoundIndex: 0 })).toMatch(/nothing to compare/)
  })

  it('rejects when an unresolved bulk operation exists', () => {
    expect(evaluateHouseholdReflectionGate({ ...base, hasUnresolvedBulkOperation: true })).toMatch(/unresolved bulk/)
  })

  it('rejects when households are misaligned on round index', () => {
    expect(evaluateHouseholdReflectionGate({ ...base, householdRoundIndices: [6, 5, 6] })).toMatch(/not aligned/)
  })
})

describe('buildHouseholdClassComparisonPublicView', () => {
  const teams = [{ teamId: 'team-b', displayName: 'チームB' }, { teamId: 'team-a', displayName: 'チームA' }]
  const entries = [
    entry('team-a', 'profile-a', 'team-a:profile-a', 0),
    entry('team-b', 'profile-b', 'team-b:profile-b', 0),
  ]
  const householdStates: Record<string, HouseholdState> = {
    'team-a:profile-a': state({ householdId: 'team-a:profile-a', goalDelayedRounds: 0 }),
    'team-b:profile-b': state({
      householdId: 'team-b:profile-b', teamId: 'team-b', profileId: 'profile-b',
      cashYen: 2000000, assetHoldingsYen: { DOMESTIC_STOCK: 1000000 },
      activeLiabilities: {}, goalDelayedRounds: 2,
    }),
  }

  it('sorts teams by teamId and computes safe totals + lifeGoalAchievementScore using the class-wide finalRoundCount', () => {
    const view = buildHouseholdClassComparisonPublicView({
      courseFormat: 'ROLE_VARIANT', finalRoundCount: 6, publishedAtMillis: 1000,
      teams, entries, profiles: [profileA, profileB], householdStates,
    })

    expect(view.courseFormat).toBe('ROLE_VARIANT')
    expect(view.finalRoundCount).toBe(6)
    expect(view.publishedAtMillis).toBe(1000)
    expect(view.teams.map((t) => t.teamDisplayName)).toEqual(['チームA', 'チームB'])

    const householdA = view.teams[0].households[0]
    expect(householdA.profileId).toBe('profile-a')
    expect(householdA.cashYen).toBe(1000000)
    expect(householdA.totalAssetsYen).toBe(700000) // 500000 + 200000
    expect(householdA.totalLiabilitiesYen).toBe(300000)
    expect(householdA.goalDelayedRounds).toBe(0)
    expect(householdA.lifeGoalAchievementScore).toBe(100) // 0 delayed rounds -> 100

    const householdB = view.teams[1].households[0]
    expect(householdB.totalAssetsYen).toBe(1000000)
    expect(householdB.totalLiabilitiesYen).toBe(0)
    expect(householdB.goalDelayedRounds).toBe(2)
    // computeLifeGoalAchievementScore({goalDelayedRounds:2, totalRounds:6}) = round(100 - 2/6*100) = 67
    expect(householdB.lifeGoalAchievementScore).toBe(67)
  })

  it('builds household.profile exclusively through toHouseholdProfilePublicView (never a spread of the internal HouseholdProfile/HouseholdState)', () => {
    const view = buildHouseholdClassComparisonPublicView({
      courseFormat: 'ROLE_VARIANT', finalRoundCount: 6, publishedAtMillis: 1000,
      teams, entries, profiles: [profileA, profileB], householdStates,
    })
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('eventProbabilityOverrides')
    expect(serialized).not.toContain('internalRiskFactors')
    // Neither runtime householdId ('team-a:profile-a' / 'team-b:profile-b')
    // nor the HouseholdState.lessonRunId field ever appears in the output.
    expect(serialized).not.toContain('team-a:profile-a')
    expect(serialized).not.toContain('team-b:profile-b')
    expect(serialized).not.toContain('lessonRunId')
  })

  it('skips a team with no resolvable households rather than emitting an empty team row', () => {
    const view = buildHouseholdClassComparisonPublicView({
      courseFormat: 'ROLE_VARIANT', finalRoundCount: 6, publishedAtMillis: 1000,
      teams: [...teams, { teamId: 'team-c', displayName: 'チームC' }],
      entries, profiles: [profileA, profileB], householdStates,
    })
    expect(view.teams.map((t) => t.teamDisplayName)).toEqual(['チームA', 'チームB'])
  })
})

// `readHouseholdFinalComparisonWithAdminSdk` is a thin Admin SDK read with no
// independent logic of its own to unit test in isolation — its behavior is
// exercised end-to-end via `statusTransition.test.ts`'s RTDB-republish tests
// (mocked `firebase-admin/firestore` there), matching this file's "pure
// logic here, Admin SDK wiring exercised by the caller's tests" split.
//
// `hasUnresolvedBulkSettlementOperationInTransaction`, by contrast, has real
// filtering logic of its own (reads the WHOLE top-level, lessonRunId-unscoped
// `householdBulkSettlementOperations` collection through `tx.getCollection`
// and filters by `lessonRunId`/`status` itself — see its JSDoc for why), so
// it is unit-tested directly here rather than only through
// `statusTransition.test.ts`'s end-to-end REFLECTION-gate tests.
describe('hasUnresolvedBulkSettlementOperationInTransaction', () => {
  const op = (overrides: Partial<{ lessonRunId: string; status: string }> = {}) => ({
    operationId: 'op-1', lessonRunId: 'run-1', status: 'RUNNING', ...overrides,
  })

  it('throws when the transaction has no getCollection support — proves this reads through tx, not a standalone Admin SDK query', async () => {
    const tx = { get: async () => ({ exists: false, data: () => undefined }), set: () => {} }
    await expect(hasUnresolvedBulkSettlementOperationInTransaction(tx, 'run-1'))
      .rejects.toThrow('getCollection support')
  })

  it('reads the collection through tx.getCollection rather than any other path', async () => {
    let requestedPath: string | null = null
    const tx = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: () => {},
      getCollection: async (path: string) => { requestedPath = path; return [] },
    }
    await hasUnresolvedBulkSettlementOperationInTransaction(tx, 'run-1')
    expect(requestedPath).toBe('householdBulkSettlementOperations')
  })

  it('returns true when an unresolved (RUNNING) operation exists for this lesson run', async () => {
    const tx = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: () => {},
      getCollection: async () => [{ id: 'op-1', data: op({ status: 'RUNNING' }) }],
    }
    expect(await hasUnresolvedBulkSettlementOperationInTransaction(tx, 'run-1')).toBe(true)
  })

  it('returns false when the only operation for this lesson run is COMPLETED', async () => {
    const tx = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: () => {},
      getCollection: async () => [{ id: 'op-1', data: op({ status: 'COMPLETED' }) }],
    }
    expect(await hasUnresolvedBulkSettlementOperationInTransaction(tx, 'run-1')).toBe(false)
  })

  it('returns false when the only operation for this lesson run is CANCELLED', async () => {
    const tx = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: () => {},
      getCollection: async () => [{ id: 'op-1', data: op({ status: 'CANCELLED' }) }],
    }
    expect(await hasUnresolvedBulkSettlementOperationInTransaction(tx, 'run-1')).toBe(false)
  })

  // Regression: the collection is top-level and unscoped by lessonRunId —
  // an unresolved operation belonging to a DIFFERENT lesson run must not
  // count, proving the `lessonRunId` filter is genuinely applied.
  it('returns false when the unresolved operation belongs to a different lesson run', async () => {
    const tx = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: () => {},
      getCollection: async () => [{ id: 'op-1', data: op({ lessonRunId: 'run-OTHER', status: 'RUNNING' }) }],
    }
    expect(await hasUnresolvedBulkSettlementOperationInTransaction(tx, 'run-1')).toBe(false)
  })

  it('returns false when no operations exist at all', async () => {
    const tx = { get: async () => ({ exists: false, data: () => undefined }), set: () => {}, getCollection: async () => [] }
    expect(await hasUnresolvedBulkSettlementOperationInTransaction(tx, 'run-1')).toBe(false)
  })
})
