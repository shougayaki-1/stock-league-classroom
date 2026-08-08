import { describe, expect, it, vi } from 'vitest'
import { deletionOperationPath, runDeletionSaga, type DeletionSagaGroup, type SagaStore } from './deletionSaga'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'

const makeFakeSagaStore = (): SagaStore & { docs: Map<string, Record<string, unknown>> } => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    get: async (path) => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (path, data) => { docs.set(path, data) },
  }
}

const baseInput = {
  uid: 'teacher-a',
  orgId: 'personal_teacher-a',
  operationKind: 'RESOURCE_PURGE',
  target: 'lessonRuns/run-1',
  confirmedIdentifier: 'run-1',
  idempotencyKey: 'key-1',
}

describe('runDeletionSaga', () => {
  it('runs every group and scrubs the operation doc to {status, requestDigest, completedAt} only', async () => {
    const store = makeFakeSagaStore()
    const firestoreRun = vi.fn().mockResolvedValue(undefined)
    const rtdbRun = vi.fn().mockResolvedValue(undefined)
    const groups: DeletionSagaGroup[] = [{ name: 'firestore', run: firestoreRun }, { name: 'rtdb', run: rtdbRun }]

    const result = await runDeletionSaga({
      ...baseInput, store, buildGroups: () => groups, now: () => new Date('2026-08-07T00:00:00.000Z'),
    })

    expect(result.completed).toBe(true)
    expect(result.alreadyCompleted).toBe(false)
    expect(firestoreRun).toHaveBeenCalledTimes(1)
    expect(rtdbRun).toHaveBeenCalledTimes(1)

    const operationPath = deletionOperationPath(baseInput.orgId, baseInput.idempotencyKey)
    const finalDoc = store.docs.get(operationPath)
    expect(finalDoc).toEqual({
      status: 'DONE',
      requestDigest: requestDigest({
        uid: baseInput.uid, orgId: baseInput.orgId, operationKind: baseInput.operationKind,
        target: baseInput.target, confirmedIdentifier: baseInput.confirmedIdentifier,
      }),
      completedAt: '2026-08-07T00:00:00.000Z',
    })
    // No group names, enumeration, uid, orgId, target, or confirmedIdentifier survive completion.
    expect(Object.keys(finalDoc as object).sort()).toEqual(['completedAt', 'requestDigest', 'status'])
  })

  it('resumes only the pending group after a Firestore-succeeds/RTDB-fails partial failure', async () => {
    const store = makeFakeSagaStore()
    const firestoreRun = vi.fn().mockResolvedValue(undefined)
    const rtdbRun = vi.fn()
      .mockRejectedValueOnce(new Error('RTDB unavailable'))
      .mockResolvedValueOnce(undefined)
    const groups: DeletionSagaGroup[] = [{ name: 'firestore', run: firestoreRun }, { name: 'rtdb', run: rtdbRun }]
    const buildGroups = () => groups

    await expect(runDeletionSaga({ ...baseInput, store, buildGroups })).rejects.toThrow('RTDB unavailable')
    expect(firestoreRun).toHaveBeenCalledTimes(1)
    expect(rtdbRun).toHaveBeenCalledTimes(1)

    const operationPath = deletionOperationPath(baseInput.orgId, baseInput.idempotencyKey)
    expect(store.docs.get(operationPath)).toMatchObject({ status: 'IN_PROGRESS', groups: { firestore: 'DONE', rtdb: 'PENDING' } })

    const result = await runDeletionSaga({ ...baseInput, store, buildGroups })
    expect(result.completed).toBe(true)
    expect(result.alreadyCompleted).toBe(false)
    // firestore group must NOT be re-attempted on retry — only the pending rtdb group runs again.
    expect(firestoreRun).toHaveBeenCalledTimes(1)
    expect(rtdbRun).toHaveBeenCalledTimes(2)
    expect(store.docs.get(operationPath)).toMatchObject({ status: 'DONE' })
  })

  it('resumes only the pending group after an RTDB-succeeds/Firestore-fails partial failure (reverse order)', async () => {
    const store = makeFakeSagaStore()
    const rtdbRun = vi.fn().mockResolvedValue(undefined)
    const firestoreRun = vi.fn()
      .mockRejectedValueOnce(new Error('Firestore unavailable'))
      .mockResolvedValueOnce(undefined)
    const groups: DeletionSagaGroup[] = [{ name: 'rtdb', run: rtdbRun }, { name: 'firestore', run: firestoreRun }]
    const buildGroups = () => groups

    await expect(runDeletionSaga({ ...baseInput, store, buildGroups })).rejects.toThrow('Firestore unavailable')
    expect(rtdbRun).toHaveBeenCalledTimes(1)
    expect(firestoreRun).toHaveBeenCalledTimes(1)

    const operationPath = deletionOperationPath(baseInput.orgId, baseInput.idempotencyKey)
    expect(store.docs.get(operationPath)).toMatchObject({ status: 'IN_PROGRESS', groups: { rtdb: 'DONE', firestore: 'PENDING' } })

    const result = await runDeletionSaga({ ...baseInput, store, buildGroups })
    expect(result.completed).toBe(true)
    // rtdb group must NOT be re-attempted on retry.
    expect(rtdbRun).toHaveBeenCalledTimes(1)
    expect(firestoreRun).toHaveBeenCalledTimes(2)
    expect(store.docs.get(operationPath)).toMatchObject({ status: 'DONE' })
  })

  it('rejects a retry that reuses the same idempotencyKey with a different payload, both while in progress and after completion', async () => {
    const store = makeFakeSagaStore()
    const failingRun = vi.fn().mockRejectedValue(new Error('boom'))
    const groups: DeletionSagaGroup[] = [{ name: 'firestore', run: failingRun }]

    await expect(runDeletionSaga({ ...baseInput, store, buildGroups: () => groups })).rejects.toThrow('boom')
    await expect(runDeletionSaga({ ...baseInput, target: 'lessonRuns/run-2', store, buildGroups: () => groups }))
      .rejects.toThrow('Idempotency key payload mismatch')

    const okGroups: DeletionSagaGroup[] = [{ name: 'firestore', run: vi.fn().mockResolvedValue(undefined) }]
    await runDeletionSaga({ ...baseInput, store, buildGroups: () => okGroups })
    await expect(runDeletionSaga({ ...baseInput, confirmedIdentifier: 'someone-else', store, buildGroups: () => okGroups }))
      .rejects.toThrow('Idempotency key payload mismatch')
  })

  it('is a safe no-op when the same operation is run again after already completing — no group is re-invoked', async () => {
    const store = makeFakeSagaStore()
    const run = vi.fn().mockResolvedValue(undefined)
    const groups: DeletionSagaGroup[] = [{ name: 'firestore', run }]

    const first = await runDeletionSaga({ ...baseInput, store, buildGroups: () => groups })
    expect(first.alreadyCompleted).toBe(false)
    const second = await runDeletionSaga({ ...baseInput, store, buildGroups: () => groups })
    expect(second.alreadyCompleted).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('calls enumerate() exactly once and reuses its persisted result across a retry, even after the enumerated data would no longer be queryable', async () => {
    const store = makeFakeSagaStore()
    const enumerate = vi.fn().mockResolvedValue({ runIds: ['run-1', 'run-2'] })
    const seenRunIds: string[][] = []
    const rtdbRun = vi.fn()
      .mockRejectedValueOnce(new Error('RTDB unavailable'))
      .mockResolvedValueOnce(undefined)
    const buildGroups = (enumeration: { runIds: string[] }): DeletionSagaGroup[] => {
      seenRunIds.push(enumeration.runIds)
      return [
        { name: 'firestore', run: vi.fn().mockResolvedValue(undefined) },
        { name: 'rtdb', run: () => rtdbRun(enumeration.runIds) },
      ]
    }

    await expect(runDeletionSaga({ ...baseInput, store, enumerate, buildGroups })).rejects.toThrow('RTDB unavailable')
    await runDeletionSaga({ ...baseInput, store, enumerate, buildGroups })

    expect(enumerate).toHaveBeenCalledTimes(1)
    expect(rtdbRun).toHaveBeenNthCalledWith(2, ['run-1', 'run-2'])
    expect(seenRunIds.every((ids) => ids.toString() === ['run-1', 'run-2'].toString())).toBe(true)
  })

  it('derives the operation document path as privacyDeletionOperations/{idempotencyDocumentId(orgId, idempotencyKey)}', () => {
    expect(deletionOperationPath('personal_teacher-a', 'key-1')).toBe(
      `privacyDeletionOperations/${idempotencyDocumentId('personal_teacher-a', 'key-1')}`,
    )
  })
})
