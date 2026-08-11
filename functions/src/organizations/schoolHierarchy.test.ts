import { describe, expect, it, vi } from 'vitest'
import { linkSchoolToParentOrg, listChildSchools, unlinkSchoolFromParentOrg } from './schoolHierarchy'
describe('school hierarchy', () => {
  it('rejects non-school and already-linked schools', async () => {
    await expect(linkSchoolToParentOrg({ getOrg: async () => ({ type: 'personal', parentOrgId: null }), setParentOrgId: vi.fn(), createZeroAllocation: vi.fn() }, { parentOrgId: 'p', schoolOrgId: 's' })).rejects.toThrow('対象は学校組織ではありません')
    await expect(linkSchoolToParentOrg({ getOrg: async () => ({ type: 'school', parentOrgId: 'other' }), setParentOrgId: vi.fn(), createZeroAllocation: vi.fn() }, { parentOrgId: 'p', schoolOrgId: 's' })).rejects.toThrow('この学校は既に別の上位組織に所属しています')
  })
  it('links a school and creates its zero-guarantee allocation', async () => {
    const set = vi.fn()
    const createZeroAllocation = vi.fn()
    await linkSchoolToParentOrg({ getOrg: async () => ({ type: 'school', parentOrgId: null }), setParentOrgId: set, createZeroAllocation }, { parentOrgId: 'p', schoolOrgId: 's' })
    expect(set).toHaveBeenCalledWith('s', 'p')
    expect(createZeroAllocation).toHaveBeenCalledWith('p', 's')
  })
  it('unlinks a school only when it has no shared-quota reservations', async () => {
    const clear = vi.fn()
    const deleteAllocation = vi.fn()
    await unlinkSchoolFromParentOrg({ getOrg: async () => ({ parentOrgId: 'p' }), getReservationCount: async () => 0, clearParentOrgId: clear, deleteAllocation }, { schoolOrgId: 's' })
    expect(clear).toHaveBeenCalledWith('s')
    expect(deleteAllocation).toHaveBeenCalledWith('p', 's')
    await expect(unlinkSchoolFromParentOrg({ getOrg: async () => ({ parentOrgId: 'p' }), getReservationCount: async () => 1, clearParentOrgId: vi.fn(), deleteAllocation: vi.fn() }, { schoolOrgId: 's' })).rejects.toThrow('共有枠の予約が残っているため学校を解除できません')
  })
  it('rejects unlinked schools and lists children', async () => { await expect(unlinkSchoolFromParentOrg({ getOrg: async () => ({ parentOrgId: null }), getReservationCount: async () => 0, clearParentOrgId: vi.fn(), deleteAllocation: vi.fn() }, { schoolOrgId: 's' })).rejects.toThrow('この学校はどの上位組織にも所属していません'); const queryChildSchools = vi.fn().mockResolvedValue([]); await listChildSchools({ queryChildSchools }, { parentOrgId: 'p' }); expect(queryChildSchools).toHaveBeenCalledWith('p') })
})
