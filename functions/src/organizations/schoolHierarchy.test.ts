import { describe, expect, it, vi } from 'vitest'
import { linkSchoolToParentOrg, listChildSchools, unlinkSchoolFromParentOrg } from './schoolHierarchy'
describe('school hierarchy', () => {
  it('rejects non-school and already-linked schools', async () => {
    await expect(linkSchoolToParentOrg({ getOrg: async () => ({ type: 'personal', parentOrgId: null }), setParentOrgId: vi.fn() }, { parentOrgId: 'p', schoolOrgId: 's' })).rejects.toThrow('対象は学校組織ではありません')
    await expect(linkSchoolToParentOrg({ getOrg: async () => ({ type: 'school', parentOrgId: 'other' }), setParentOrgId: vi.fn() }, { parentOrgId: 'p', schoolOrgId: 's' })).rejects.toThrow('この学校は既に別の上位組織に所属しています')
  })
  it('links and unlinks schools', async () => { const set = vi.fn(); await linkSchoolToParentOrg({ getOrg: async () => ({ type: 'school', parentOrgId: null }), setParentOrgId: set }, { parentOrgId: 'p', schoolOrgId: 's' }); expect(set).toHaveBeenCalledWith('s', 'p'); const clear = vi.fn(); await unlinkSchoolFromParentOrg({ getOrg: async () => ({ parentOrgId: 'p' }), clearParentOrgId: clear }, { schoolOrgId: 's' }); expect(clear).toHaveBeenCalledWith('s') })
  it('rejects unlinked schools and lists children', async () => { await expect(unlinkSchoolFromParentOrg({ getOrg: async () => ({ parentOrgId: null }), clearParentOrgId: vi.fn() }, { schoolOrgId: 's' })).rejects.toThrow('この学校はどの上位組織にも所属していません'); const queryChildSchools = vi.fn().mockResolvedValue([]); await listChildSchools({ queryChildSchools }, { parentOrgId: 'p' }); expect(queryChildSchools).toHaveBeenCalledWith('p') })
})
