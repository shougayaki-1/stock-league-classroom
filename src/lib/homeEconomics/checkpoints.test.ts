import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { writeHouseholdCheckpoint, restoreHouseholdCheckpoint } = await import('./checkpoints')

describe('checkpoints (client)', () => {
  it('calls writeHouseholdCheckpointCallable with params', async () => {
    const mockResult = { checkpointId: 'cp-1', created: true }
    callable.mockResolvedValue({ data: mockResult })
    const functions = {} as Functions

    const input = {
      lessonRunId: 'run-1',
      label: '手動チェックポイント',
      idempotencyKey: 'k-1',
    }
    const result = await writeHouseholdCheckpoint(functions, input)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'writeHouseholdCheckpointCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual(mockResult)
  })

  it('calls restoreHouseholdCheckpointCallable with params', async () => {
    const mockResult = { newRestoreGeneration: 2, restoredHouseholdIds: ['team-a'], preRestoreCheckpointId: 'pre-1' }
    callable.mockResolvedValue({ data: mockResult })
    const functions = {} as Functions

    const input = {
      lessonRunId: 'run-1',
      checkpointId: 'cp-1',
      reason: 'テスト復元',
      idempotencyKey: 'k-1',
    }
    const result = await restoreHouseholdCheckpoint(functions, input)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'restoreHouseholdCheckpointCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual(mockResult)
  })
})
