import { describe, expect, it } from 'vitest'
import { purgeHardDelete, requestSoftDelete, restoreSoftDeleted } from './deletePersonalData'

const makeFakeStore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
    update: async (path: string, data: Record<string, unknown>) => { docs.set(path, { ...docs.get(path), ...data }) },
    clearPendingDeletion: async (path: string) => { const { pendingDeletion: _, ...rest } = docs.get(path) ?? {}; docs.set(path, rest) },
    recursiveDelete: async (path: string) => { for (const key of docs.keys()) if (key === path || key.startsWith(`${path}/`)) docs.delete(key) },
  }
}

describe('requestSoftDelete', () => {
  it('marks a lessonRun for deletion 30 days out instead of deleting it immediately', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { orgId: 'personal_teacher-a', status: 'COMPLETED' })
    const now = () => new Date('2026-08-05T00:00:00.000Z')
    await requestSoftDelete({ store, path: 'lessonRuns/run-1', now, reason: '誤操作' })
    const doc = store.docs.get('lessonRuns/run-1')
    expect(doc?.pendingDeletion).toMatchObject({ reason: '誤操作', purgeAfter: '2026-09-04T00:00:00.000Z' })
    expect(store.docs.has('lessonRuns/run-1')).toBe(true) // still present — not actually deleted yet
  })
})

describe('restoreSoftDeleted', () => {
  it('clears pendingDeletion within the 30-day window', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { orgId: 'personal_teacher-a', pendingDeletion: { reason: 'x', purgeAfter: '2026-09-04T00:00:00.000Z' } })
    await restoreSoftDeleted({ store, path: 'lessonRuns/run-1', now: () => new Date('2026-08-20T00:00:00.000Z') })
    expect(store.docs.get('lessonRuns/run-1')?.pendingDeletion).toBeUndefined()
  })

  it('rejects restore once the 30-day deadline has elapsed', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { pendingDeletion: { purgeAfter: '2026-09-04T00:00:00.000Z' } })
    await expect(restoreSoftDeleted({ store, path: 'lessonRuns/run-1', now: () => new Date('2026-09-05T00:00:00.000Z') }))
      .rejects.toThrow('Restore window expired')
  })
})

describe('purgeHardDelete', () => {
  it('deletes immediately with no restore path, for a formal complete-deletion request (spec §21.3 priority 1, §26-9)', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { orgId: 'personal_teacher-a' })
    store.docs.set('lessonRuns/run-1/events/e1', { orgId: 'personal_teacher-a' })
    store.docs.set('lessonRuns/run-1/checkpoints/c1', { orgId: 'personal_teacher-a' })
    await purgeHardDelete({ store, path: 'lessonRuns/run-1' })
    expect(store.docs.has('lessonRuns/run-1')).toBe(false)
    expect([...store.docs.keys()].some((key) => key.startsWith('lessonRuns/run-1/'))).toBe(false)
  })
})
