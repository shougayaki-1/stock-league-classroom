import { describe, expect, it } from 'vitest'
import { generateRandomJoinCode, invalidateJoinCode, issueJoinCode } from './joinCodes'

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

describe('generateRandomJoinCode', () => {
  it('produces a 6-character code using only the confusion-free alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateRandomJoinCode()
      expect(code).toHaveLength(6)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
      expect(code).not.toMatch(/[0O1I]/)
    }
  })

  it('does not repeat the same code on consecutive calls (sanity check, not a statistical proof)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRandomJoinCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('issueJoinCode', () => {
  it('reserves a unique code for a READY lesson run', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { status: 'READY' })
    const result = await issueJoinCode({
      firestore: fake as never, lessonRunId: 'run-1', generateCode: () => 'ABCDEF',
    })
    expect(result.code).toBe('ABCDEF')
    expect(fake.docs.get('lessonJoinCodes/ABCDEF')).toMatchObject({
      code: 'ABCDEF', lessonRunId: 'run-1', status: 'ACTIVE',
    })
  })

  it('allows issuance for a WAITING lesson run', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { status: 'WAITING' })
    const result = await issueJoinCode({
      firestore: fake as never, lessonRunId: 'run-1', generateCode: () => 'ABCDEF',
    })
    expect(result.code).toBe('ABCDEF')
  })

  it('rejects issuance when the lesson run is not READY/WAITING', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { status: 'DRAFT' })
    await expect(issueJoinCode({
      firestore: fake as never, lessonRunId: 'run-1', generateCode: () => 'ABCDEF',
    })).rejects.toThrow('LessonRun is not accepting join codes in its current status')
  })

  it('rejects issuance for a nonexistent lesson run', async () => {
    const fake = makeFakeFirestore()
    await expect(issueJoinCode({
      firestore: fake as never, lessonRunId: 'missing', generateCode: () => 'ABCDEF',
    })).rejects.toThrow('LessonRun not found')
  })

  it('retries on collision with an already-issued live code', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { status: 'READY' })
    fake.docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-0', status: 'ACTIVE' })
    let calls = 0
    const result = await issueJoinCode({
      firestore: fake as never, lessonRunId: 'run-1',
      generateCode: () => { calls += 1; return calls === 1 ? 'ABCDEF' : 'GHJKLM' },
    })
    expect(result.code).toBe('GHJKLM')
    expect(calls).toBe(2)
  })

  it('gives up after maxAttempts collisions', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { status: 'READY' })
    fake.docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-0', status: 'ACTIVE' })
    await expect(issueJoinCode({
      firestore: fake as never, lessonRunId: 'run-1', generateCode: () => 'ABCDEF', maxAttempts: 3,
    })).rejects.toThrow('Unable to allocate a unique join code')
  })
})

describe('invalidateJoinCode', () => {
  it('marks an active code as invalidated', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-1', status: 'ACTIVE' })
    await invalidateJoinCode({ firestore: fake as never, code: 'ABCDEF' })
    expect(fake.docs.get('lessonJoinCodes/ABCDEF')).toMatchObject({ status: 'INVALIDATED' })
  })

  it('is idempotent for an already-invalidated code', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-1', status: 'INVALIDATED' })
    await expect(invalidateJoinCode({ firestore: fake as never, code: 'ABCDEF' })).resolves.toBeUndefined()
  })

  it('rejects invalidating a nonexistent code', async () => {
    const fake = makeFakeFirestore()
    await expect(invalidateJoinCode({ firestore: fake as never, code: 'MISSING' })).rejects.toThrow('Join code not found')
  })
})
