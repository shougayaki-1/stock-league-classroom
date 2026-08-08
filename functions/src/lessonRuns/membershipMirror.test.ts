import { Timestamp } from 'firebase-admin/firestore'
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
  joinedAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00Z')),
  lastSeenAt: Timestamp.fromDate(new Date('2024-01-01T00:05:00Z')),
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

  it('honors an explicit accessOverride, forcing access REVOKED while still recording the true participantStatus (not a fabricated one)', async () => {
    const setMirror = vi.fn(async () => {})
    // A participant whose real, honest status is MIGRATING_DEVICE (an
    // *active* status per activeParticipantStatuses) must still be able to
    // have this specific mirror entry forced to REVOKED — e.g. the old-UID
    // mirror during device recovery — without lying about participantStatus
    // to get there.
    const migrating: LessonParticipant = { ...activeParticipant, status: 'MIGRATING_DEVICE' }

    const mirror = await syncLessonRunMembership(
      { setMirror, now: () => 5_000 },
      { participant: migrating, membershipVersion: 7, accessOverride: 'REVOKED' },
    )

    expect(mirror.access).toBe('REVOKED')
    expect(mirror.participantStatus).toBe('MIGRATING_DEVICE')
    expect(setMirror).toHaveBeenCalledWith('run-1', 'student-a', expect.objectContaining({
      access: 'REVOKED',
      participantStatus: 'MIGRATING_DEVICE',
    }))
  })

  it('honors an explicit accessOverride of ACTIVE even for a non-active participant status', async () => {
    const setMirror = vi.fn(async () => {})
    const suspended: LessonParticipant = { ...activeParticipant, status: 'SUSPENDED' }

    const mirror = await syncLessonRunMembership(
      { setMirror, now: () => 6_000 },
      { participant: suspended, membershipVersion: 8, accessOverride: 'ACTIVE' },
    )

    expect(mirror.access).toBe('ACTIVE')
    expect(mirror.participantStatus).toBe('SUSPENDED')
  })

  it('falls back to deriving access from participant.status when accessOverride is not supplied (existing callers unaffected)', async () => {
    const setMirror = vi.fn(async () => {})

    const mirror = await syncLessonRunMembership(
      { setMirror, now: () => 7_000 },
      { participant: activeParticipant, membershipVersion: 9 },
    )

    expect(mirror.access).toBe('ACTIVE')
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
