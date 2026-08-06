import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance.
const fullExport = {
  exportedAt: '2026-08-07T12:00:00.000Z',
  uid: 'teacher-a',
  orgId: 'personal_teacher-a',
  user: { id: 'teacher-a' },
  organization: { id: 'personal_teacher-a', type: 'personal' },
  membership: { uid: 'teacher-a', role: 'owner', status: 'active' },
  orgAccessMirror: { role: 'owner', status: 'active', membershipVersion: 1 },
  orgAccessMeta: { membershipVersion: 1, syncState: 'SYNCED' },
  lessonTemplates: [],
  lessonRuns: [],
}
const callable = vi.fn().mockResolvedValue({ data: fullExport })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { exportPersonalData } = await import('./exportPersonalData')

describe('exportPersonalData (client)', () => {
  it('calls exportPersonalDataCallable with no arguments and returns the JSON result as-is', async () => {
    const functions = {} as Functions
    const result = await exportPersonalData(functions)
    expect(result).toEqual(fullExport)
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'exportPersonalDataCallable')
    expect(callable).toHaveBeenCalledWith()
  })
})
