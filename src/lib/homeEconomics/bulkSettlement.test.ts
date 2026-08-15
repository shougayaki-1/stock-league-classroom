import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { processHouseholdRoundBatch, retryHouseholdRoundBatch } = await import('./bulkSettlement')

describe('bulkSettlement (client)', () => {
  it('calls processHouseholdRoundBatchCallable with params', async () => {
    const mockView = { operationId: 'op-1', status: 'COMPLETED' }
    callable.mockResolvedValue({ data: mockView })
    const functions = {} as Functions

    const input = {
      lessonRunId: 'run-1',
      expectedRoundIndex: 1,
      forceUnsubmitted: false,
      idempotencyKey: 'k-1',
    }
    const result = await processHouseholdRoundBatch(functions, input)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'processHouseholdRoundBatchCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual(mockView)
  })

  it('calls retryHouseholdRoundBatchCallable with params', async () => {
    const mockView = { operationId: 'op-1', status: 'COMPLETED' }
    callable.mockResolvedValue({ data: mockView })
    const functions = {} as Functions

    const input = {
      lessonRunId: 'run-1',
      operationId: 'op-1',
    }
    const result = await retryHouseholdRoundBatch(functions, input)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'retryHouseholdRoundBatchCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual(mockView)
  })
})
