import { describe, expect, it } from 'vitest'
import { listOrgMembers } from './orgMembers'

describe('listOrgMembers', () => {
  it('resolves each member uid to an email address', async () => {
    const result = await listOrgMembers({
      getMemberDocs: async (orgId) => {
        expect(orgId).toBe('org-1')
        return [
          { uid: 'uid-owner', role: 'owner', status: 'active', membershipVersion: 1 },
          { uid: 'uid-teacher', role: 'teacher', status: 'suspended', membershipVersion: 2 },
        ]
      },
      resolveEmails: async (uids) => {
        expect(uids).toEqual(['uid-owner', 'uid-teacher'])
        return { 'uid-owner': 'owner@example.com', 'uid-teacher': null }
      },
    }, { orgId: 'org-1' })

    expect(result).toEqual([
      { uid: 'uid-owner', email: 'owner@example.com', role: 'owner', status: 'active', membershipVersion: 1 },
      { uid: 'uid-teacher', email: null, role: 'teacher', status: 'suspended', membershipVersion: 2 },
    ])
  })

  it('does not call resolveEmails for an empty member list', async () => {
    const result = await listOrgMembers({
      getMemberDocs: async () => [],
      resolveEmails: async () => { throw new Error('should not be called') },
    }, { orgId: 'org-1' })
    expect(result).toEqual([])
  })
})
