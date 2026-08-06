import { describe, expect, it } from 'vitest'
import { requireActiveOrgMember } from './authorization'

const makeFirestore = (doc: { exists: boolean; data?: Record<string, unknown> }) => ({
  doc: () => ({
    get: async () => ({
      exists: doc.exists,
      get: (field: string) => doc.data?.[field],
    }),
  }),
}) as never

describe('requireActiveOrgMember', () => {
  it('returns the role and membershipVersion for an active member', async () => {
    const firestore = makeFirestore({ exists: true, data: { status: 'active', role: 'owner', membershipVersion: 3 } })
    await expect(requireActiveOrgMember(firestore, 'org-1', 'uid-1')).resolves.toEqual({ role: 'owner', membershipVersion: 3 })
  })

  it('rejects with permission-denied when the membership document is missing', async () => {
    const firestore = makeFirestore({ exists: false })
    await expect(requireActiveOrgMember(firestore, 'org-1', 'uid-1')).rejects.toThrow('有効な組織メンバーではありません。')
  })

  it('rejects with permission-denied when the member is suspended', async () => {
    const firestore = makeFirestore({ exists: true, data: { status: 'suspended', role: 'owner', membershipVersion: 2 } })
    await expect(requireActiveOrgMember(firestore, 'org-1', 'uid-1')).rejects.toThrow('有効な組織メンバーではありません。')
  })
})
