import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance.
const callable = vi.fn().mockResolvedValue({ data: { orgId: 'personal_uid-1', created: true } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { ensurePersonalOrg } = await import('./ensurePersonalOrg')

describe('ensurePersonalOrg', () => {
  it('calls the ensurePersonalOrgCallable callable and returns its result', async () => {
    const functions = {} as Functions
    const result = await ensurePersonalOrg(functions)
    expect(result).toEqual({ orgId: 'personal_uid-1', created: true })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'ensurePersonalOrgCallable')
    expect(callable).toHaveBeenCalledWith()
  })
})
