import { describe, expect, it } from 'vitest'
import { assignParticipantToTeam, rotateRepresentative } from './assignTeam'

// Reproduces Firestore Admin SDK's "all reads before all writes" transaction
// constraint within a single transaction (see joinLessonRun.test.ts's
// makeFakeFirestore for the same pattern, added after Task 3's Critical #1
// read-after-write bug slipped through an earlier fake that didn't enforce
// this).
const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
      })
    },
  }
}

const setUpTeams = (docs: Map<string, Record<string, unknown>>) => {
  docs.set('lessonRuns/run-1/meta/teamsIndex', { teamIds: ['team-a', 'team-b'] })
  docs.set('lessonRuns/run-1/teams/team-a', {
    id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
    memberParticipantIds: ['p-1', 'p-2', 'p-3'], confirmationMode: 'ALL', version: 0,
  })
  docs.set('lessonRuns/run-1/teams/team-b', {
    id: 'team-b', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'B',
    memberParticipantIds: ['p-4', 'p-5'], confirmationMode: 'ALL', version: 0,
  })
  docs.set('lessonRuns/run-1/participants/p-new', {
    id: 'p-new', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'auth-new',
    identityMode: 'QUICK_JOIN', displayName: 'new', status: 'ACTIVE', sessionVersion: 0,
    joinedAt: 'now', lastSeenAt: 'now',
  })
}

describe('assignParticipantToTeam', () => {
  it('assigns the participant to the smallest team and records a team event', async () => {
    const fake = makeFakeFirestore()
    setUpTeams(fake.docs)
    const result = await assignParticipantToTeam({
      firestore: fake as never, actorId: 'teacher-1', now: () => 'fixed-now',
    }, { lessonRunId: 'run-1', participantId: 'p-new', idempotencyKey: 'assign-1' })

    expect(result.teamId).toBe('team-b')
    expect(result.deduplicated).toBe(false)
    const team = fake.docs.get('lessonRuns/run-1/teams/team-b') as { memberParticipantIds: string[]; version: number }
    expect(team.memberParticipantIds).toContain('p-new')
    expect(team.version).toBe(1)
    const participant = fake.docs.get('lessonRuns/run-1/participants/p-new') as { teamId: string }
    expect(participant.teamId).toBe('team-b')
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
  })

  it('deduplicates a retried assignment with the same idempotencyKey', async () => {
    const fake = makeFakeFirestore()
    setUpTeams(fake.docs)
    const deps = { firestore: fake as never, actorId: 'teacher-1', now: () => 'fixed-now' }
    const first = await assignParticipantToTeam(deps, { lessonRunId: 'run-1', participantId: 'p-new', idempotencyKey: 'assign-1' })
    const retry = await assignParticipantToTeam(deps, { lessonRunId: 'run-1', participantId: 'p-new', idempotencyKey: 'assign-1' })

    expect(retry.teamId).toBe(first.teamId)
    expect(retry.deduplicated).toBe(true)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
  })

  it('rejects assigning a participant who already has a team', async () => {
    const fake = makeFakeFirestore()
    setUpTeams(fake.docs)
    fake.docs.set('lessonRuns/run-1/participants/p-1', {
      id: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'auth-1', teamId: 'team-a',
      identityMode: 'QUICK_JOIN', displayName: 'one', status: 'ACTIVE', sessionVersion: 0,
      joinedAt: 'now', lastSeenAt: 'now',
    })
    await expect(assignParticipantToTeam(
      { firestore: fake as never, actorId: 'teacher-1', now: () => 'fixed-now' },
      { lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'assign-2' },
    )).rejects.toThrow('Participant is already assigned to a team')
  })
})

describe('rotateRepresentative', () => {
  it('changes the representative and records TEAM_REPRESENTATIVE_CHANGED with before/after and reason', async () => {
    const fake = makeFakeFirestore()
    setUpTeams(fake.docs)
    fake.docs.set('lessonRuns/run-1/teams/team-a', {
      id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
      memberParticipantIds: ['p-1', 'p-2', 'p-3'], representativeParticipantId: 'p-1',
      confirmationMode: 'REPRESENTATIVE', version: 3,
    })

    const result = await rotateRepresentative({
      firestore: fake as never, actorId: 'teacher-1', actorType: 'TEACHER', now: () => 'fixed-now',
    }, {
      lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2',
      reason: '手動交代', idempotencyKey: 'rotate-1',
    })

    expect(result.previousRepresentativeParticipantId).toBe('p-1')
    expect(result.newRepresentativeParticipantId).toBe('p-2')
    expect(result.version).toBe(4)
    expect(result.deduplicated).toBe(false)
    const team = fake.docs.get('lessonRuns/run-1/teams/team-a') as { representativeParticipantId: string; version: number }
    expect(team.representativeParticipantId).toBe('p-2')
    expect(team.version).toBe(4)
    const eventKey = [...fake.docs.keys()].find((k) => k.includes('/events/'))
    const event = fake.docs.get(eventKey as string) as { type: string; payload: unknown }
    expect(event.type).toBe('TEAM_REPRESENTATIVE_CHANGED')
    expect(event.payload).toMatchObject({
      teamId: 'team-a', previousRepresentativeParticipantId: 'p-1',
      newRepresentativeParticipantId: 'p-2', reason: '手動交代',
    })
  })

  it('supports an automatic-reason rotation (e.g. representative disconnect) via the same generic function', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teams/team-a', {
      id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
      memberParticipantIds: ['p-1', 'p-2'], representativeParticipantId: 'p-1',
      confirmationMode: 'REPRESENTATIVE', version: 0,
    })
    const result = await rotateRepresentative({
      firestore: fake as never, actorId: 'system', actorType: 'SYSTEM', now: () => 'fixed-now',
    }, {
      lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2',
      reason: '代表者の接続断による自動昇格', idempotencyKey: 'auto-1',
    })
    expect(result.newRepresentativeParticipantId).toBe('p-2')
  })

  it('rejects rotating to a non-member participant', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teams/team-a', {
      id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
      memberParticipantIds: ['p-1', 'p-2'], representativeParticipantId: 'p-1',
      confirmationMode: 'REPRESENTATIVE', version: 0,
    })
    await expect(rotateRepresentative(
      { firestore: fake as never, actorId: 'teacher-1', actorType: 'TEACHER', now: () => 'fixed-now' },
      { lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-99', reason: 'x', idempotencyKey: 'rotate-2' },
    )).rejects.toThrow('New representative must be a member of the team')
  })

  it('rejects a stale expectedVersion (optimistic concurrency)', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teams/team-a', {
      id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
      memberParticipantIds: ['p-1', 'p-2'], representativeParticipantId: 'p-1',
      confirmationMode: 'REPRESENTATIVE', version: 5,
    })
    await expect(rotateRepresentative(
      { firestore: fake as never, actorId: 'teacher-1', actorType: 'TEACHER', now: () => 'fixed-now' },
      {
        lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2',
        reason: 'x', idempotencyKey: 'rotate-3', expectedVersion: 4,
      },
    )).rejects.toThrow('Team version mismatch')
  })

  it('rejects a retried idempotencyKey whose payload differs from the original', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teams/team-a', {
      id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
      memberParticipantIds: ['p-1', 'p-2'], representativeParticipantId: 'p-1',
      confirmationMode: 'REPRESENTATIVE', version: 0,
    })
    const deps = { firestore: fake as never, actorId: 'teacher-1', actorType: 'TEACHER' as const, now: () => 'fixed-now' }
    await rotateRepresentative(deps, {
      lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2', reason: 'A', idempotencyKey: 'k1',
    })
    await expect(rotateRepresentative(deps, {
      lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2', reason: 'B', idempotencyKey: 'k1',
    })).rejects.toThrow('Idempotency key payload mismatch')
  })
})
