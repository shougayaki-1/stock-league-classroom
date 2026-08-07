import { describe, expect, it, vi } from 'vitest'
import type { LessonParticipant } from './participants/repository'
import { syncLessonRunMembership } from './membershipMirror'

const activeParticipant: LessonParticipant = {
  id: 'participant-1',
  lessonRunId: 'run-1',
  orgId: 'personal_teacher-a',
  authUid: 'student-a',
  identityMode: 'SCHOOL_ACCOUNT',
  displayName: '生徒A',
  teamId: 'team-a',
  status: 'ACTIVE',
  sessionVersion: 1,
  joinedAt: 'joined-at' as never,
  lastSeenAt: 'last-seen-at' as never,
}

describe('syncLessonRunMembership', () => {
  it('replaces lessonRunMembership/{runId}/{authUid} wholesale via set(), mapping ACTIVE status to access ACTIVE', async () => {
    const setMirror = vi.fn(async () => {})
    const now = () => 1_000

    const mirror = await syncLessonRunMembership(
      { setMirror, now },
      { participant: activeParticipant, membershipVersion: 3 },
    )

    expect(setMirror).toHaveBeenCalledTimes(1)
    expect(setMirror).toHaveBeenCalledWith('run-1', 'student-a', mirror)
    expect(mirror).toEqual({
      orgId: 'personal_teacher-a',
      participantId: 'participant-1',
      teamId: 'team-a',
      access: 'ACTIVE',
      participantStatus: 'ACTIVE',
      membershipVersion: 3,
      sessionVersion: 1,
      updatedAtMillis: 1000,
    })
  })

  it('maps a SUSPENDED participant to access REVOKED rather than deleting the mirror entry, keeping it auditable', async () => {
    const setMirror = vi.fn(async () => {})
    const suspended: LessonParticipant = { ...activeParticipant, status: 'SUSPENDED' }

    const mirror = await syncLessonRunMembership(
      { setMirror, now: () => 2_000 },
      { participant: suspended, membershipVersion: 4 },
    )

    expect(setMirror).toHaveBeenCalledWith('run-1', 'student-a', expect.objectContaining({
      access: 'REVOKED',
      participantStatus: 'SUSPENDED',
    }))
    expect(mirror.access).toBe('REVOKED')
  })

  it('maps ABSENT (not in activeParticipantStatuses) to access REVOKED as well', async () => {
    const setMirror = vi.fn(async () => {})
    const absent: LessonParticipant = { ...activeParticipant, status: 'ABSENT' }

    const mirror = await syncLessonRunMembership(
      { setMirror, now: () => 3_000 },
      { participant: absent, membershipVersion: 1 },
    )

    expect(mirror.access).toBe('REVOKED')
  })

  it('omits teamId from the mirror when the participant has none (e.g. an OBSERVER not yet assigned to a team)', async () => {
    const setMirror = vi.fn(async () => {})
    const { teamId: _omit, ...withoutTeam } = activeParticipant
    void _omit
    const observer: LessonParticipant = { ...withoutTeam, status: 'OBSERVER' }

    const mirror = await syncLessonRunMembership(
      { setMirror, now: () => 4_000 },
      { participant: observer, membershipVersion: 1 },
    )

    expect(mirror).not.toHaveProperty('teamId')
    expect(mirror.access).toBe('ACTIVE')
  })
})
