import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance.
const callable = vi.fn().mockResolvedValue({ data: { lessonRunId: 'run-1', created: true } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { createLessonRun } = await import('./createLessonRun')

describe('createLessonRun (client)', () => {
  it('calls the createLessonRunCallable callable with only templateId/lessonRunIdempotencyKey', async () => {
    const functions = {} as Functions
    const result = await createLessonRun(functions, { templateId: 't1', lessonRunIdempotencyKey: 'key-1' })
    expect(result).toEqual({ lessonRunId: 'run-1', created: true })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'createLessonRunCallable')
    expect(callable).toHaveBeenCalledWith({ templateId: 't1', lessonRunIdempotencyKey: 'key-1' })
  })
})
