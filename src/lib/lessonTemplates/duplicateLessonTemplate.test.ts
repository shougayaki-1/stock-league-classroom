import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance.
const callable = vi.fn().mockResolvedValue({ data: { templateId: 'template-copy-1', alreadyDuplicated: false } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { duplicateLessonTemplate } = await import('./duplicateLessonTemplate')

describe('duplicateLessonTemplate (client)', () => {
  it('calls the duplicateLessonTemplateCallable callable with only sourceTemplateId/sourceVersionId/targetOrgId/confirmedOverrides/idempotencyKey', async () => {
    const functions = {} as Functions
    const result = await duplicateLessonTemplate(functions, {
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      targetOrgId: 'org-target',
      confirmedOverrides: {},
      idempotencyKey: 'key-1',
    })
    expect(result).toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'duplicateLessonTemplateCallable')
    expect(callable).toHaveBeenCalledWith({
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      targetOrgId: 'org-target',
      confirmedOverrides: {},
      idempotencyKey: 'key-1',
    })
  })
})
