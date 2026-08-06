import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const {
  purgeHardDelete,
  purgePersonalOrganization,
  requestSoftDelete,
  restoreSoftDeleted,
} = await import('./deletePersonalData')

const functions = {} as Functions

describe('requestSoftDelete (client)', () => {
  it('calls requestSoftDeleteCallable with the given path and reason', async () => {
    callable.mockResolvedValue({ data: { path: 'lessonRuns/run-1' } })
    const result = await requestSoftDelete(functions, { path: 'lessonRuns/run-1', reason: '誤操作' })
    expect(result).toEqual({ path: 'lessonRuns/run-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'requestSoftDeleteCallable')
    expect(callable).toHaveBeenCalledWith({ path: 'lessonRuns/run-1', reason: '誤操作' })
  })
})

describe('restoreSoftDeleted (client)', () => {
  it('calls restoreSoftDeletedCallable with the given path', async () => {
    callable.mockResolvedValue({ data: { path: 'lessonRuns/run-1' } })
    const result = await restoreSoftDeleted(functions, { path: 'lessonRuns/run-1' })
    expect(result).toEqual({ path: 'lessonRuns/run-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'restoreSoftDeletedCallable')
    expect(callable).toHaveBeenCalledWith({ path: 'lessonRuns/run-1' })
  })
})

describe('purgeHardDelete (client)', () => {
  it('calls purgeHardDeleteCallable with confirm, confirmTargetId, and idempotencyKey', async () => {
    callable.mockResolvedValue({ data: { operationId: 'op-1', completed: true, alreadyCompleted: false } })
    const input = { path: 'lessonRuns/run-1', confirm: true as const, confirmTargetId: 'run-1', idempotencyKey: 'k1' }
    const result = await purgeHardDelete(functions, input)
    expect(result).toEqual({ operationId: 'op-1', completed: true, alreadyCompleted: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'purgeHardDeleteCallable')
    expect(callable).toHaveBeenCalledWith(input)
  })
})

describe('purgePersonalOrganization (client)', () => {
  it('calls purgePersonalOrganizationCallable with confirm, confirmUid, and idempotencyKey, never sending orgId', async () => {
    callable.mockResolvedValue({ data: { operationId: 'op-2', completed: true, alreadyCompleted: false } })
    const input = { confirm: true as const, confirmUid: 'teacher-a', idempotencyKey: 'org-key-1' }
    const result = await purgePersonalOrganization(functions, input)
    expect(result).toEqual({ operationId: 'op-2', completed: true, alreadyCompleted: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'purgePersonalOrganizationCallable')
    expect(callable).toHaveBeenCalledWith(input)
  })
})
