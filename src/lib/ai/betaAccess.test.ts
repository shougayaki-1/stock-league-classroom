import type { Functions } from 'firebase/functions'
import { httpsCallable } from 'firebase/functions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMyAiBetaAccess,
  grantAiBetaAccess,
  listAiBetaAccess,
  revokeAiBetaAccess,
} from './betaAccess'

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}))

describe('AI beta access client wrappers', () => {
  const dummyFunctions = {} as unknown as Functions
  const callableMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(httpsCallable).mockReturnValue(callableMock as any)
  })

  it('calls getMyAiBetaAccessCallable and returns data', async () => {
    callableMock.mockResolvedValueOnce({ data: { approved: true } })
    const result = await getMyAiBetaAccess(dummyFunctions)

    expect(httpsCallable).toHaveBeenCalledWith(dummyFunctions, 'getMyAiBetaAccessCallable')
    expect(callableMock).toHaveBeenCalledWith()
    expect(result).toEqual({ approved: true })
  })

  it('calls listAiBetaAccessCallable and returns data', async () => {
    const list = [
      {
        teacherUid: 't-1',
        email: 't1@example.com',
        approvedByUid: 'op-1',
        approvedAtMillis: 1700000000000,
      },
    ]
    callableMock.mockResolvedValueOnce({ data: list })
    const result = await listAiBetaAccess(dummyFunctions)

    expect(httpsCallable).toHaveBeenCalledWith(dummyFunctions, 'listAiBetaAccessCallable')
    expect(callableMock).toHaveBeenCalledWith()
    expect(result).toEqual(list)
  })

  it('calls grantAiBetaAccessCallable with correct input and returns data', async () => {
    callableMock.mockResolvedValueOnce({
      data: { changed: true, teacherUid: 't-1' },
    })
    const input = {
      email: 'teacher@example.com',
      reason: 'Approved for test',
      idempotencyKey: 'key-123',
    }
    const result = await grantAiBetaAccess(dummyFunctions, input)

    expect(httpsCallable).toHaveBeenCalledWith(dummyFunctions, 'grantAiBetaAccessCallable')
    expect(callableMock).toHaveBeenCalledWith(input)
    expect(result).toEqual({ changed: true, teacherUid: 't-1' })
  })

  it('calls revokeAiBetaAccessCallable with correct input and returns data', async () => {
    callableMock.mockResolvedValueOnce({
      data: { changed: true, teacherUid: 't-1' },
    })
    const input = {
      teacherUid: 't-1',
      reason: 'Terminated',
      idempotencyKey: 'key-456',
    }
    const result = await revokeAiBetaAccess(dummyFunctions, input)

    expect(httpsCallable).toHaveBeenCalledWith(dummyFunctions, 'revokeAiBetaAccessCallable')
    expect(callableMock).toHaveBeenCalledWith(input)
    expect(result).toEqual({ changed: true, teacherUid: 't-1' })
  })
})
