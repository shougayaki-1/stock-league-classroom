import { describe, expect, it } from 'vitest'
import { assignBalancedTeam, canConfirmTeamResponse, type LessonTeam } from './repository'

const baseTeam = (overrides: Partial<LessonTeam> = {}): LessonTeam => ({
  id: 'team-1',
  lessonRunId: 'run-1',
  orgId: 'org-1',
  displayName: 'チーム1',
  memberParticipantIds: ['participant-1'],
  representativeParticipantId: 'participant-1',
  confirmationMode: 'REPRESENTATIVE',
  version: 0,
  ...overrides,
})

describe('assignBalancedTeam', () => {
  it('returns the id of the smallest team', () => {
    expect(assignBalancedTeam([{ id: 'a', size: 3 }, { id: 'b', size: 2 }])).toBe('b')
  })

  it('is deterministic (prefers the first team) when sizes tie', () => {
    expect(assignBalancedTeam([{ id: 'a', size: 1 }, { id: 'b', size: 1 }])).toBe('a')
  })

  it('throws when given an empty list', () => {
    expect(() => assignBalancedTeam([])).toThrow('At least one team is required')
  })
})

describe('canConfirmTeamResponse', () => {
  it('REPRESENTATIVE mode: only the representative can confirm', () => {
    const team = baseTeam({ confirmationMode: 'REPRESENTATIVE', representativeParticipantId: 'participant-1' })
    expect(canConfirmTeamResponse(team, 'participant-1')).toBe(true)
    expect(canConfirmTeamResponse(team, 'participant-2')).toBe(false)
  })

  it('ALL mode: any team member can confirm', () => {
    const team = baseTeam({
      confirmationMode: 'ALL',
      memberParticipantIds: ['participant-1', 'participant-2'],
      representativeParticipantId: undefined,
    })
    expect(canConfirmTeamResponse(team, 'participant-1')).toBe(true)
    expect(canConfirmTeamResponse(team, 'participant-2')).toBe(true)
    expect(canConfirmTeamResponse(team, 'participant-3')).toBe(false)
  })

  it('QUORUM mode: any team member can individually confirm (aggregation is a separate concern)', () => {
    const team = baseTeam({
      confirmationMode: 'QUORUM',
      memberParticipantIds: ['participant-1', 'participant-2', 'participant-3'],
      requiredApprovalCount: 2,
      representativeParticipantId: undefined,
    })
    expect(canConfirmTeamResponse(team, 'participant-2')).toBe(true)
    expect(canConfirmTeamResponse(team, 'participant-4')).toBe(false)
  })
})
