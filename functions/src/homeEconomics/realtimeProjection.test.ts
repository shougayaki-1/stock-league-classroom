import { describe, expect, it } from 'vitest'
import type { HouseholdState } from '../lessonRuns/households/repository'
import { toHouseholdStateTeamView } from './realtimeProjection'

const household: HouseholdState = {
  householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 1500000,
  assetHoldingsYen: { DOMESTIC_STOCK: 800000 }, activeInsuranceContracts: { 'ins-1': 7 },
  activeLiabilities: { 'loan-1': { remainingPrincipalYen: 18000000, remainingYears: 15, annualInterestRatePercent: 2 } },
  lifeStage: 'CHILD_REARING', roundIndex: 4, goalDelayedRounds: 1, updatedAtServerMillis: 1234,
}

describe('toHouseholdStateTeamView', () => {
  it('never leaks the other team\'s data — this function only ever sees ONE household by construction', () => {
    const view = toHouseholdStateTeamView(household, ['EMERGENCY_FUND'], [], [])
    expect(view.householdId).toBe('case-b')
  })

  it('never leaks internal risk factors or claim probabilities — allow-list only, matching liveTypes.ts field-for-field', () => {
    const view = toHouseholdStateTeamView(household, ['EMERGENCY_FUND'], [], [])
    expect(JSON.stringify(view)).not.toContain('internalClaimProbability')
    expect(JSON.stringify(view)).not.toContain('internalRiskFactors')
    expect(JSON.stringify(view)).not.toContain('eventProbabilityOverrides')
  })

  it('is always fictional (spec §13.4 — this must render as "これは授業用の架空プロフィールです" client-side)', () => {
    const view = toHouseholdStateTeamView(household, [], [], [])
    expect(view.isFictional).toBe(true)
  })

  it('respects the goal-package concept visibility filter — hidden concepts are omitted, not merely flagged', () => {
    const view = toHouseholdStateTeamView(household, ['EMERGENCY_FUND'], [], [])
    expect(view.visibleConcepts).toEqual(['EMERGENCY_FUND'])
  })
})
