import { describe, expect, it } from 'vitest'
import { appendLessonEvent, appendLessonEventInTransaction } from './appendLessonEvent'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    // Reproduces Firestore Admin SDK's real "all reads before all writes"
    // per-transaction constraint (see joinLessonRun.test.ts's fake for the
    // full rationale): `written` resets on every `runTransaction` call, and
    // any `get` after a `set` within that same transaction throws.
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => {
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

describe('appendLessonEvent', () => {
  it('assigns sequence 0 to the first event and increments per lessonRunId', async () => {
    const fake = makeFakeFirestore()
    const deps = { firestore: fake as never, lessonRunId: 'run-1', orgId: 'org-1', type: 'PARTICIPANT_JOINED', actorType: 'STUDENT' as const, actorId: 'student-1', payload: {}, idempotencyKey: 'evt-1' }
    const first = await appendLessonEvent(deps)
    const second = await appendLessonEvent({ ...deps, idempotencyKey: 'evt-2', type: 'PARTICIPANT_LEFT' })
    expect(first.sequence).toBe(0)
    expect(second.sequence).toBe(1)
  })

  it('deduplicates a retried idempotencyKey without advancing sequence again', async () => {
    const fake = makeFakeFirestore()
    const deps = { firestore: fake as never, lessonRunId: 'run-1', orgId: 'org-1', type: 'PARTICIPANT_JOINED', actorType: 'STUDENT' as const, actorId: 'student-1', payload: {}, idempotencyKey: 'evt-1' }
    const first = await appendLessonEvent(deps)
    const retried = await appendLessonEvent(deps)
    expect(retried).toEqual({ ...first, deduplicated: true })
    const third = await appendLessonEvent({ ...deps, idempotencyKey: 'evt-2' })
    expect(third.sequence).toBe(1) // not 2 — the deduplicated retry did not consume a sequence number
  })

  it('hashes slash-containing keys and rejects the same key with a different payload', async () => {
    const fake = makeFakeFirestore()
    const base = { firestore: fake as never, lessonRunId: 'run-1', orgId: 'org-1', type: 'NOTE', actorType: 'TEACHER' as const, actorId: 'teacher-1', payload: { text: 'a' }, idempotencyKey: 'unsafe/key' }
    await appendLessonEvent(base)
    await expect(appendLessonEvent({ ...base, payload: { text: 'b' } })).rejects.toThrow('Idempotency key payload mismatch')
  })
})

describe('appendLessonEventInTransaction', () => {
  const makeTx = (docs: Map<string, Record<string, unknown>>) => ({
    get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
  })

  it('hashes slash-containing idempotency keys into a valid Firestore path and rejects a payload mismatch on retry', async () => {
    const docs = new Map<string, Record<string, unknown>>()
    const tx = makeTx(docs)
    const input = { lessonRunId: 'run-1', orgId: 'org-1', type: 'NOTE', actorType: 'TEACHER' as const, actorId: 'teacher-1', payload: { text: 'a' }, idempotencyKey: 'unsafe/key' }

    const first = await appendLessonEventInTransaction(tx, input, 'now-1')
    expect(first).toEqual({ eventId: 'run-1_0', sequence: 0, deduplicated: false })
    // the idempotency doc's path must not contain the raw (slash-containing) key.
    const idempotencyPaths = [...docs.keys()].filter((path) => path.includes('/eventIdempotency/'))
    expect(idempotencyPaths).toHaveLength(1)
    expect(idempotencyPaths[0]).not.toContain('unsafe/key')

    await expect(
      appendLessonEventInTransaction(tx, { ...input, payload: { text: 'b' } }, 'now-2'),
    ).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('returns the prior result unchanged (deduplicated: true) for a semantically identical retry, without advancing the counter', async () => {
    const docs = new Map<string, Record<string, unknown>>()
    const tx = makeTx(docs)
    const input = { lessonRunId: 'run-1', orgId: 'org-1', type: 'NOTE', actorType: 'TEACHER' as const, actorId: 'teacher-1', payload: { text: 'a' }, idempotencyKey: 'key-1' }

    const first = await appendLessonEventInTransaction(tx, input, 'now-1')
    const retried = await appendLessonEventInTransaction(tx, { ...input }, 'now-2')
    expect(retried).toEqual({ ...first, deduplicated: true })

    const next = await appendLessonEventInTransaction(tx, { ...input, idempotencyKey: 'key-2' }, 'now-3')
    expect(next.sequence).toBe(1)
  })
})
