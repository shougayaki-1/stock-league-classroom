import { describe, expect, it } from 'vitest'
import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import {
  buildDefaultHouseholdAssignmentEntries,
  runtimeHouseholdId,
  teamSetFingerprint,
  validateHouseholdAssignmentEntries,
} from './householdAssignment'

const profile = (overrides: Partial<HouseholdProfile> & { householdId: string }): HouseholdProfile => ({
  age: 32,
  householdIncomeYen: 6000000,
  annualLivingExpensesYen: 3000000,
  cashSavingsYen: 2000000,
  family: '配偶者・子2人',
  housing: '賃貸マンション',
  lifeGoal: '住宅購入と教育資金',
  lifeStage: 'CHILD_REARING',
  eventProbabilityOverrides: {},
  internalRiskFactors: {},
  ...overrides,
})

const profileA = profile({ householdId: 'profile-a', lifeStage: 'STUDENT' })
const profileB = profile({ householdId: 'profile-b', lifeStage: 'CHILD_REARING' })
const profileC = profile({ householdId: 'profile-c', lifeStage: 'RETIRED' })

describe('buildDefaultHouseholdAssignmentEntries — ROLE_VARIANT', () => {
  it('round-robins the profile snapshot across teams sorted by teamId ascending, wrapping deterministically', () => {
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-b', 'team-a', 'team-c'],
      profiles: [profileA, profileB],
    })

    expect(entries.map((entry) => [entry.teamId, entry.profileId])).toEqual([
      ['team-a', 'profile-a'],
      ['team-b', 'profile-b'],
      ['team-c', 'profile-a'],
    ])
  })

  it('is independent of the input team array order (same result regardless of caller ordering)', () => {
    const forward = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b', 'team-c'],
      profiles: [profileA, profileB],
    })
    const shuffled = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-c', 'team-b', 'team-a'],
      profiles: [profileA, profileB],
    })
    expect(shuffled).toEqual(forward)
  })

  it('produces stable, opaque runtime household ids derived from lessonRunId/teamId/slotKey', () => {
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b'],
      profiles: [profileA, profileB],
    })
    for (const entry of entries) {
      expect(entry.householdId).toBe(runtimeHouseholdId('run-1', entry.teamId, entry.slotKey))
    }
    // Different teams sharing the same source profile still get distinct runtime ids.
    const wrapEntries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b', 'team-c'],
      profiles: [profileA, profileB],
    })
    const teamA = wrapEntries.find((entry) => entry.teamId === 'team-a')!
    const teamC = wrapEntries.find((entry) => entry.teamId === 'team-c')!
    expect(teamA.profileId).toBe(teamC.profileId)
    expect(teamA.householdId).not.toBe(teamC.householdId)
  })
})

describe('buildDefaultHouseholdAssignmentEntries — STAGE_SPLIT', () => {
  it('gives every distinct lifeStage one team before any stage gets a second team', () => {
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'STAGE_SPLIT',
      teamIds: ['team-a', 'team-b', 'team-c'],
      profiles: [profileA, profileB, profileC],
    })
    expect(entries.map((entry) => entry.teamId)).toEqual(['team-a', 'team-b', 'team-c'])
    // three distinct stages, three teams: one-to-one
    expect(new Set(entries.map((entry) => entry.profileId)).size).toBe(3)
  })

  it('balances extra teams round-robin across stages once every stage has one team', () => {
    // 2 distinct stages (STUDENT once, CHILD_REARING twice), 4 teams.
    const stageProfileA2 = profile({ householdId: 'profile-a2', lifeStage: 'CHILD_REARING' })
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'STAGE_SPLIT',
      teamIds: ['team-a', 'team-b', 'team-c', 'team-d'],
      profiles: [profileA, profileB, stageProfileA2],
    })
    // stages in snapshot order of first occurrence: STUDENT, CHILD_REARING
    // team-a -> STUDENT (profile-a), team-b -> CHILD_REARING (profile-b, first occurrence)
    // team-c -> STUDENT (only 1 profile in STUDENT, wraps to profile-a again)
    // team-d -> CHILD_REARING (second occurrence: profile-a2)
    expect(entries.map((entry) => [entry.teamId, entry.profileId])).toEqual([
      ['team-a', 'profile-a'],
      ['team-b', 'profile-b'],
      ['team-c', 'profile-a'],
      ['team-d', 'profile-a2'],
    ])
  })

  it('is INVALID when there are fewer teams than distinct stages', () => {
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'STAGE_SPLIT',
      teamIds: ['team-a', 'team-b'],
      profiles: [profileA, profileB, profileC],
    })
    const validation = validateHouseholdAssignmentEntries({
      courseFormat: 'STAGE_SPLIT',
      teamIds: ['team-a', 'team-b'],
      profiles: [profileA, profileB, profileC],
      entries,
    })
    expect(validation.status).toBe('INVALID')
  })
})

describe('buildDefaultHouseholdAssignmentEntries — MULTI_PERSON_PER_TEAM', () => {
  it('assigns the entire profile set (snapshot order) to every team', () => {
    const teamIds = ['team-b', 'team-a']
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      teamIds,
      profiles: [profileA, profileB, profileC],
    })

    const teamAEntries = entries.filter((entry) => entry.teamId === 'team-a')
    const teamBEntries = entries.filter((entry) => entry.teamId === 'team-b')
    expect(teamAEntries.map((entry) => entry.profileId)).toEqual(['profile-a', 'profile-b', 'profile-c'])
    expect(teamBEntries.map((entry) => entry.profileId)).toEqual(['profile-a', 'profile-b', 'profile-c'])
  })

  it('gives the same source profile a distinct runtime householdId per team', () => {
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      teamIds: ['team-a', 'team-b'],
      profiles: [profileA, profileB],
    })
    const profileAInTeamA = entries.find((entry) => entry.teamId === 'team-a' && entry.profileId === 'profile-a')!
    const profileAInTeamB = entries.find((entry) => entry.teamId === 'team-b' && entry.profileId === 'profile-a')!
    expect(profileAInTeamA.householdId).not.toBe(profileAInTeamB.householdId)
  })

  it('is INVALID when the run has only one household profile (multi-person mode requires >= 2)', () => {
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1',
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      teamIds: ['team-a', 'team-b'],
      profiles: [profileA],
    })
    const validation = validateHouseholdAssignmentEntries({
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      teamIds: ['team-a', 'team-b'],
      profiles: [profileA],
      entries,
    })
    expect(validation.status).toBe('INVALID')
  })
})

describe('validateHouseholdAssignmentEntries — READY cases', () => {
  it('is READY for a well-formed ROLE_VARIANT assignment', () => {
    const teamIds = ['team-a', 'team-b']
    const profiles = [profileA, profileB]
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', teamIds, profiles,
    })
    expect(validateHouseholdAssignmentEntries({ courseFormat: 'ROLE_VARIANT', teamIds, profiles, entries }).status).toBe('READY')
  })

  it('is READY for a well-formed MULTI_PERSON_PER_TEAM assignment', () => {
    const teamIds = ['team-a', 'team-b']
    const profiles = [profileA, profileB]
    const entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: 'run-1', courseFormat: 'MULTI_PERSON_PER_TEAM', teamIds, profiles,
    })
    expect(validateHouseholdAssignmentEntries({ courseFormat: 'MULTI_PERSON_PER_TEAM', teamIds, profiles, entries }).status).toBe('READY')
  })
})

describe('teamSetFingerprint', () => {
  it('is independent of input team array order', () => {
    expect(teamSetFingerprint(['team-b', 'team-a'])).toBe(teamSetFingerprint(['team-a', 'team-b']))
  })

  it('differs for different team sets', () => {
    expect(teamSetFingerprint(['team-a', 'team-b'])).not.toBe(teamSetFingerprint(['team-a', 'team-c']))
  })
})

describe('runtimeHouseholdId', () => {
  it('is deterministic for the same inputs', () => {
    expect(runtimeHouseholdId('run-1', 'team-a', 'slot-0')).toBe(runtimeHouseholdId('run-1', 'team-a', 'slot-0'))
  })

  it('differs when any input differs', () => {
    const base = runtimeHouseholdId('run-1', 'team-a', 'slot-0')
    expect(runtimeHouseholdId('run-2', 'team-a', 'slot-0')).not.toBe(base)
    expect(runtimeHouseholdId('run-1', 'team-b', 'slot-0')).not.toBe(base)
    expect(runtimeHouseholdId('run-1', 'team-a', 'slot-1')).not.toBe(base)
  })
})
