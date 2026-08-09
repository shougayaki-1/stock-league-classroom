import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { linkSchoolToParentOrg, listChildSchools, unlinkSchoolFromParentOrg } from './schoolHierarchy'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('schoolHierarchy client wrappers', () => {
  it('calls the three hierarchy Callables', async () => { const call = vi.fn().mockResolvedValue({ data: [] }); vi.mocked(httpsCallable).mockReturnValue(call as never); await linkSchoolToParentOrg({} as never, { parentOrgId: 'p', schoolOrgId: 's' }); await unlinkSchoolFromParentOrg({} as never, { schoolOrgId: 's' }); await listChildSchools({} as never, { parentOrgId: 'p' }); expect(httpsCallable).toHaveBeenCalledWith({}, 'linkSchoolToParentOrgCallable'); expect(httpsCallable).toHaveBeenCalledWith({}, 'unlinkSchoolFromParentOrgCallable'); expect(httpsCallable).toHaveBeenCalledWith({}, 'listChildSchoolsCallable') })
})
