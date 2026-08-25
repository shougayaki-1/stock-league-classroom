import { describe, expect, it } from 'vitest'
import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import type { HouseholdState } from '../lessonRuns/households/repository'
import { toAdvancedHouseholdTeamEntryView, toAdvancedHouseholdTeamStateView, toHouseholdStateTeamView } from './realtimeProjection'

const household: HouseholdState = {
  householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 1500000,
  assetHoldingsYen: { DOMESTIC_STOCK: 800000 }, activeInsuranceContracts: { 'ins-1': 7 },
  activeLiabilities: { 'loan-1': { remainingPrincipalYen: 18000000, remainingYears: 15, annualInterestRatePercent: 2 } },
  lifeStage: 'CHILD_REARING', roundIndex: 4, goalDelayedRounds: 1, updatedAtServerMillis: 1234,
}

const profileA: HouseholdProfile = {
  householdId: 'profile-a', age: 30, householdIncomeYen: 5000000, annualLivingExpensesYen: 3000000,
  cashSavingsYen: 1000000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄', lifeStage: 'INDEPENDENT',
  eventProbabilityOverrides: {}, internalRiskFactors: { mortalityRisk: 0.02 },
}

const profileB: HouseholdProfile = {
  ...profileA, householdId: 'case-b', family: '配偶者・子1人', lifeStage: 'CHILD_REARING',
}

describe('toHouseholdStateTeamView', () => {
  it('never leaks the other team\'s data — this function only ever sees ONE household by construction', () => {
    const view = toHouseholdStateTeamView(profileB, household, ['EMERGENCY_FUND'], [], [])
    expect(view.householdId).toBe('case-b')
  })

  it('never leaks internal risk factors or claim probabilities — allow-list only, matching liveTypes.ts field-for-field', () => {
    const view = toHouseholdStateTeamView(profileB, household, ['EMERGENCY_FUND'], [], [])
    expect(JSON.stringify(view)).not.toContain('internalClaimProbability')
    expect(JSON.stringify(view)).not.toContain('internalRiskFactors')
    expect(JSON.stringify(view)).not.toContain('eventProbabilityOverrides')
  })

  it('is always fictional (spec §13.4 — this must render as "これは授業用の架空プロフィールです" client-side)', () => {
    const view = toHouseholdStateTeamView(profileB, household, [], [], [])
    expect(view.isFictional).toBe(true)
  })

  it('respects the goal-package concept visibility filter — hidden concepts are omitted, not merely flagged', () => {
    const view = toHouseholdStateTeamView(profileB, household, ['EMERGENCY_FUND'], [], [])
    expect(view.visibleConcepts).toEqual(['EMERGENCY_FUND'])
  })

  it('carries the resolved profile summary — semantic lifeStage/family, not a server-composed copy string', () => {
    const view = toHouseholdStateTeamView(profileB, household, [], [], [])
    expect(view.profileSummary).toEqual({
      lifeStage: 'CHILD_REARING',
      family: '配偶者・子1人',
    })
    expect(JSON.stringify(view)).not.toContain('internalRiskFactors')
  })
})

describe('toAdvancedHouseholdTeamEntryView', () => {
  it('projects the profile through toHouseholdProfilePublicView — never leaks internalRiskFactors/eventProbabilityOverrides', () => {
    const entry = toAdvancedHouseholdTeamEntryView(profileA, household, ['EMERGENCY_FUND'], [], [], null)
    expect(JSON.stringify(entry)).not.toContain('internalRiskFactors')
    expect(JSON.stringify(entry)).not.toContain('eventProbabilityOverrides')
    expect(JSON.stringify(entry)).not.toContain('mortalityRisk')
    expect(entry.profile.isFictional).toBe(true)
  })

  it('carries the household\'s runtime state and the given submittedRoundIndex through unchanged', () => {
    const entry = toAdvancedHouseholdTeamEntryView(profileA, household, ['EMERGENCY_FUND'], [], [], 4)
    expect(entry.householdId).toBe('case-b')
    expect(entry.state.roundIndex).toBe(4)
    expect(entry.submittedRoundIndex).toBe(4)
  })

  it('reports submittedRoundIndex as null when the household has not yet submitted for its current round', () => {
    const entry = toAdvancedHouseholdTeamEntryView(profileA, household, [], [], [], null)
    expect(entry.submittedRoundIndex).toBeNull()
  })
})

describe('toAdvancedHouseholdTeamStateView', () => {
  const householdB: HouseholdState = { ...household, householdId: 'household-2', profileId: 'profile-a' }

  it('keys households by householdId and preserves the given display order in householdOrder', () => {
    const entryOne = toAdvancedHouseholdTeamEntryView(profileA, household, [], [], [], null)
    const entryTwo = toAdvancedHouseholdTeamEntryView(profileA, householdB, [], [], [], null)
    const view = toAdvancedHouseholdTeamStateView('MULTI_PERSON_PER_TEAM', 2, 'OPEN', [entryOne, entryTwo])

    expect(view.courseFormat).toBe('MULTI_PERSON_PER_TEAM')
    expect(view.synchronizedRoundIndex).toBe(2)
    expect(view.roundStatus).toBe('OPEN')
    expect(view.householdOrder).toEqual(['case-b', 'household-2'])
    expect(Object.keys(view.households).sort()).toEqual(['case-b', 'household-2'])
    expect(view.households['case-b'].householdId).toBe('case-b')
    expect(view.households['household-2'].householdId).toBe('household-2')
  })
})
