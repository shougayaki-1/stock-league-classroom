import { describe, expect, it } from 'vitest'
import type { LessonParticipant } from './repository'
import { upsertParticipant } from './repository'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    set: async (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
  }
}

const baseParticipant: LessonParticipant = {
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

describe('upsertParticipant', () => {
  it('writes the participant record at lessonRuns/{lessonRunId}/participants/{id}', async () => {
    const fake = makeFakeFirestore()
    const result = await upsertParticipant({ firestore: fake }, baseParticipant)

    expect(result).toEqual(baseParticipant)
    expect(fake.docs.get('lessonRuns/run-1/participants/participant-1')).toEqual(baseParticipant)
  })

  it('overwrites a prior record for the same participant id (upsert, not append)', async () => {
    const fake = makeFakeFirestore()
    await upsertParticipant({ firestore: fake }, baseParticipant)
    const updated: LessonParticipant = { ...baseParticipant, status: 'SUSPENDED', sessionVersion: 2 }
    await upsertParticipant({ firestore: fake }, updated)

    expect(fake.docs.get('lessonRuns/run-1/participants/participant-1')).toEqual(updated)
    expect(fake.docs.size).toBe(1)
  })

  it('preserves optional fields (externalIdentifier, teamId) when present, and omits them cleanly when absent', async () => {
    const fake = makeFakeFirestore()
    const observer: LessonParticipant = {
      id: 'participant-2',
      lessonRunId: 'run-1',
      orgId: 'personal_teacher-a',
      authUid: 'student-b',
      identityMode: 'QUICK_JOIN',
      displayName: '生徒B',
      externalIdentifier: 'ext-123',
      status: 'OBSERVER',
      sessionVersion: 1,
      joinedAt: 'joined-at' as never,
      lastSeenAt: 'last-seen-at' as never,
    }
    await upsertParticipant({ firestore: fake }, observer)
    const stored = fake.docs.get('lessonRuns/run-1/participants/participant-2')
    expect(stored).toEqual(observer)
    expect(stored).not.toHaveProperty('teamId')
  })
})
