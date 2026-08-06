import { describe, expect, it } from 'vitest'
import { restoreCheckpoint, writeCheckpoint } from './checkpoint'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
      update: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
      update: (path: string, data: Record<string, unknown>) => { docs.set(path, { ...docs.get(path), ...data }) },
    }),
  }
}

describe('writeCheckpoint', () => {
  it('stores a checkpoint tagged with the current restoreGeneration', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0 })
    const result = await writeCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', phaseId: 'phase-1', sequence: 5, snapshot: { cash: 1000 }, createdBy: 'TEACHER', idempotencyKey: 'cp/key' })
    expect(fake.docs.get(`lessonRuns/run-1/checkpoints/${result.checkpointId}`)).toMatchObject({ sequence: 5, phaseId: 'phase-1', restoreGeneration: 0 })
  })

  it('never overwrites a checkpoint when the same sequence occurs in another restoreGeneration', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0 })
    const first = await writeCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', phaseId: 'p', sequence: 5, snapshot: { value: 1 }, createdBy: 'SYSTEM', idempotencyKey: 'cp-1' })
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 1 })
    const second = await writeCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', phaseId: 'p', sequence: 5, snapshot: { value: 2 }, createdBy: 'SYSTEM', idempotencyKey: 'cp-2' })
    expect(second.checkpointId).not.toBe(first.checkpointId)
    expect(fake.docs.get(`lessonRuns/run-1/checkpoints/${first.checkpointId}`)).toMatchObject({ snapshot: { value: 1 } })
  })
})

describe('restoreCheckpoint', () => {
  it('increments restoreGeneration and appends a CHECKPOINT_RESTORED event instead of deleting anything', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, orgId: 'org-1' })
    fake.docs.set('lessonRuns/run-1/checkpoints/cp-1', { id: 'cp-1', sequence: 5, restoreGeneration: 0 })
    const result = await restoreCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'テスト復元', actorId: 'teacher-a', idempotencyKey: 'restore-1' })
    expect(result.newRestoreGeneration).toBe(1)
    expect(fake.docs.get('lessonRuns/run-1')).toMatchObject({ restoreGeneration: 1 })
    expect([...fake.docs.values()]).toContainEqual(expect.objectContaining({
      lessonRunId: 'run-1', type: 'CHECKPOINT_RESTORED',
      payload: { checkpointId: 'cp-1', reason: 'テスト復元', newRestoreGeneration: 1 },
    }))
  })

  it('does not increment restoreGeneration twice when the same idempotencyKey is retried', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, orgId: 'org-1' })
    fake.docs.set('lessonRuns/run-1/checkpoints/cp-1', { id: 'cp-1', sequence: 5, restoreGeneration: 0 })
    const input = { firestore: fake as never, lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '再試行', actorId: 'teacher-a', idempotencyKey: 'restore/unsafe-key' }
    const first = await restoreCheckpoint(input)
    const retry = await restoreCheckpoint(input)
    expect(first).toMatchObject({ newRestoreGeneration: 1, deduplicated: false, eventId: expect.any(String) })
    expect(retry).toMatchObject({ newRestoreGeneration: 1, deduplicated: true, eventId: first.eventId })
    expect(fake.docs.get('lessonRuns/run-1')).toMatchObject({ restoreGeneration: 1 })
  })

  it('rejects and performs zero writes when the checkpoint does not exist', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, orgId: 'org-1' })
    const sizeBefore = fake.docs.size
    const runBefore = fake.docs.get('lessonRuns/run-1')

    await expect(restoreCheckpoint({
      firestore: fake as never, lessonRunId: 'run-1', checkpointId: 'missing-cp',
      reason: 'テスト復元', actorId: 'teacher-a', idempotencyKey: 'restore-missing',
    })).rejects.toThrow('Checkpoint not found')

    // Zero writes: no new docs (idempotency record, event) and the run doc is untouched.
    expect(fake.docs.size).toBe(sizeBefore)
    expect(fake.docs.get('lessonRuns/run-1')).toEqual(runBefore)
    expect([...fake.docs.keys()].some((k) => k.includes('checkpointRestoreIdempotency'))).toBe(false)
    expect([...fake.docs.values()].some((v) => (v as { type?: string }).type === 'CHECKPOINT_RESTORED')).toBe(false)
  })
})
