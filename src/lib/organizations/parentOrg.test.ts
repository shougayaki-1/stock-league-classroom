import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createParentOrg } from './parentOrg'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('createParentOrg', () => it('calls createParentOrgCallable', async () => { const call = vi.fn().mockResolvedValue({ data: { orgId: 'parentOrg_1' } }); vi.mocked(httpsCallable).mockReturnValue(call as never); await expect(createParentOrg({} as never, { name: '桜丘市教育委員会' })).resolves.toEqual({ orgId: 'parentOrg_1' }); expect(httpsCallable).toHaveBeenCalledWith({}, 'createParentOrgCallable') }))
