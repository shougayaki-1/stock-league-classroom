import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { migrateSchoolFromEndedParentCallable } from './parentContractMigrationOnCall'
import { requireActiveOrgMember } from './authorization'

vi.mock('./authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => ({})), FieldValue: { serverTimestamp: vi.fn() } }))

const teacher = {
  uid: 'owner-1',
  token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
} as unknown as CallableRequest['auth']

describe('migrateSchoolFromEndedParentCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects missing authentication, non-teacher authentication, and invalid input before a migration can run', async () => {
    await expect(migrateSchoolFromEndedParentCallable.run({ auth: null, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest))
      .rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(migrateSchoolFromEndedParentCallable.run({ auth: { uid: 'x', token: {} }, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest))
      .rejects.toMatchObject({ code: 'permission-denied' })
    await expect(migrateSchoolFromEndedParentCallable.run({ auth: teacher, data: {} } as unknown as CallableRequest))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('allows only a school owner or admin to request migration', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(migrateSchoolFromEndedParentCallable.run({ auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest))
      .rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).toHaveBeenCalledWith({}, 'school-1', 'owner-1')
  })
})
