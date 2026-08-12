import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { migrateSchoolFromEndedParent } from './parentContractMigration'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('migrateSchoolFromEndedParent', () => {
  it('calls migrateSchoolFromEndedParentCallable with the school id', async () => {
    const call = vi.fn().mockResolvedValue({ data: { status: 'MIGRATED', parentOrgId: 'parent-1' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(migrateSchoolFromEndedParent({} as never, { schoolOrgId: 'school-1' }))
      .resolves.toEqual({ status: 'MIGRATED', parentOrgId: 'parent-1' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'migrateSchoolFromEndedParentCallable')
    expect(call).toHaveBeenCalledWith({ schoolOrgId: 'school-1' })
  })
})
