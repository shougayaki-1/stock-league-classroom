import { describe, expect, it, vi } from 'vitest'
import { joinLessonRun } from './joinLessonRun'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

const setUpLessonRun = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-1', status: 'ACTIVE' })
  docs.set('lessonRuns/run-1', { orgId: 'org-1', status: 'READY', ...overrides })
}

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  joinCode: 'ABCDEF',
  identityMode: 'QUICK_JOIN' as const,
  displayName: 'たろう',
  idempotencyKey: 'join-1',
  ...overrides,
})

const makeDeps = (fake: ReturnType<typeof makeFakeFirestore>, overrides: Record<string, unknown> = {}) => {
  let seq = 0
  return {
    firestore: fake as never,
    authUid: 'student-a',
    generateParticipantId: () => `participant-${(seq += 1)}`,
    syncMembership: vi.fn().mockResolvedValue(undefined),
    now: () => 'fixed-now',
    ...overrides,
  }
}

describe('joinLessonRun', () => {
  it('creates a new participant, appends PARTICIPANT_JOINED once, and syncs the RTDB mirror after commit', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)

    const result = await joinLessonRun(deps, baseInput())

    expect(result.deduplicated).toBe(false)
    expect(result.lessonRunId).toBe('run-1')
    expect(result.duplicateIdentifierWarning).toBe(false)
    const participant = fake.docs.get(`lessonRuns/run-1/participants/${result.participantId}`)
    expect(participant).toMatchObject({ authUid: 'student-a', status: 'ACTIVE', sessionVersion: 0, orgId: 'org-1' })
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
    expect(deps.syncMembership).toHaveBeenCalledTimes(1)
    expect(deps.syncMembership).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', authUid: 'student-a', participantId: result.participantId, sessionVersion: 0,
    }))
  })

  it('deduplicates the same join request and warns on duplicate external identifiers', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)

    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    const retry = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))

    expect(retry.participantId).toBe(first.participantId)
    expect(retry.deduplicated).toBe(true)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
    // syncMembership still runs on a deduplicated replay (idempotent RTDB heal), but appendEvent must not run twice.
    expect(deps.syncMembership).toHaveBeenCalledTimes(2)
  })

  it('rejects a retried idempotencyKey whose payload differs from the original', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1', displayName: 'A' }))
    await expect(joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1', displayName: 'B' })))
      .rejects.toThrow('Idempotency key payload mismatch')
  })

  it('warns (but does not fail) when a second participant reuses an externalIdentifier already claimed in this run', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1', externalIdentifier: '15' }))
    const second = await joinLessonRun({ ...deps, authUid: 'student-b' }, baseInput({ idempotencyKey: 'join-2', externalIdentifier: '15' }))

    expect(first.duplicateIdentifierWarning).toBe(false)
    expect(second.duplicateIdentifierWarning).toBe(true)
    expect(second.participantId).not.toBe(first.participantId)
  })

  it('rejects joining via an inactive (invalidated) join code', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-1', status: 'INVALIDATED' })
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', status: 'READY' })
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('Join code is not active')
  })

  it('rejects a join code pointing at a lesson run that is not READY/WAITING', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs, { status: 'ENDED' })
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('LessonRun is not accepting participants')
  })

  it('rejects an unknown join code', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput({ joinCode: 'ZZZZZZ' }))).rejects.toThrow('Join code not found')
  })

  it('enforces maxParticipants for brand-new participants only', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs, { maxParticipants: 1 })
    const deps = makeDeps(fake)
    await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    await expect(joinLessonRun({ ...deps, authUid: 'student-b' }, baseInput({ idempotencyKey: 'join-2' })))
      .rejects.toThrow('LessonRun has reached its maximum number of participants')
  })

  it('treats a reconnect (same authUid rejoining) as reusing the same participant and bumping sessionVersion, not consuming a new maxParticipants slot', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs, { maxParticipants: 1 })
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    const second = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-2' }))

    expect(second.participantId).toBe(first.participantId)
    expect(second.deduplicated).toBe(false)
    const participant = fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`)
    expect(participant).toMatchObject({ sessionVersion: 1 })
  })

  it('rejects a rejoin attempt from a participant who has been suspended', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    fake.docs.set(`lessonRuns/run-1/participants/${first.participantId}`, {
      ...fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`),
      status: 'SUSPENDED',
    })
    await expect(joinLessonRun(deps, baseInput({ idempotencyKey: 'join-2' })))
      .rejects.toThrow('Participant has been suspended from this lesson')
  })

  it('does not call syncMembership when the Firestore transaction fails', async () => {
    const fake = makeFakeFirestore()
    // No lessonJoinCodes doc set up, so the transaction throws before commit.
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', status: 'READY' })
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('Join code not found')
    expect(deps.syncMembership).not.toHaveBeenCalled()
  })
})
