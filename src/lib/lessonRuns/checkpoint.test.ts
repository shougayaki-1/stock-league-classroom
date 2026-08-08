import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance.
const callable = vi.fn().mockResolvedValue({ data: { newRestoreGeneration: 1, eventId: 'run-1_1', deduplicated: false } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { restoreCheckpoint } = await import('./checkpoint')

describe('restoreCheckpoint (client)', () => {
  it('calls the restoreCheckpointCallable callable with only lessonRunId/checkpointId/reason/idempotencyKey', async () => {
    const functions = {} as Functions
    const result = await restoreCheckpoint(functions, {
      lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '巻き戻し', idempotencyKey: 'restore-1',
    })
    expect(result).toEqual({ newRestoreGeneration: 1, eventId: 'run-1_1', deduplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'restoreCheckpointCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '巻き戻し', idempotencyKey: 'restore-1',
    })
  })
})
