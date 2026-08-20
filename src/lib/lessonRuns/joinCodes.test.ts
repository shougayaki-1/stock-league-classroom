import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Functions } from 'firebase/functions'

const callable = vi.fn()
const httpsCallableMock = vi.fn(() => callable)
vi.mock('firebase/functions', () => ({ httpsCallable: httpsCallableMock }))

const { httpsCallable } = await import('firebase/functions')
const { issueJoinCode, invalidateJoinCode } = await import('./joinCodes')

beforeEach(() => {
  callable.mockReset()
  httpsCallableMock.mockClear()
})

describe('issueJoinCode (client)', () => {
  it('calls issueJoinCodeCallable and returns the join code', async () => {
    callable.mockResolvedValue({ data: { code: 'ABC234' } })
    const functions = {} as Functions

    const result = await issueJoinCode(functions, { lessonRunId: 'run-1' })

    expect(result).toEqual({ code: 'ABC234' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'issueJoinCodeCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
  })
})

describe('invalidateJoinCode (client)', () => {
  it('calls invalidateJoinCodeCallable and returns success', async () => {
    callable.mockResolvedValue({ data: { success: true } })
    const functions = {} as Functions

    const result = await invalidateJoinCode(functions, { lessonRunId: 'run-1', code: 'ABC234' })

    expect(result).toEqual({ success: true })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'invalidateJoinCodeCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', code: 'ABC234' })
  })
})
