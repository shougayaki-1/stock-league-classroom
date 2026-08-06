import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance.
const callable = vi.fn().mockResolvedValue({ data: { versionId: 'version-1', alreadyPublished: false } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { publishLessonVersion } = await import('./publishLessonVersion')

describe('publishLessonVersion (client)', () => {
  it('calls the publishLessonVersionCallable callable with only templateId/changeSummary/idempotencyKey', async () => {
    const functions = {} as Functions
    const result = await publishLessonVersion(functions, { templateId: 't1', changeSummary: '初版', idempotencyKey: 'key-1' })
    expect(result).toEqual({ versionId: 'version-1', alreadyPublished: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'publishLessonVersionCallable')
    expect(callable).toHaveBeenCalledWith({ templateId: 't1', changeSummary: '初版', idempotencyKey: 'key-1' })
  })
})
