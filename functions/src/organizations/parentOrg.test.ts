import { describe, expect, it } from 'vitest'
import { createParentOrg } from './parentOrg'
const makeFakeFirestore = () => { const docs = new Map<string, Record<string, unknown>>(); return { docs, runTransaction: async (fn: (tx: { set: (path: string, data: Record<string, unknown>) => void }) => Promise<void>) => fn({ set: (path, data) => { docs.set(path, data) } }) } }
describe('createParentOrg', () => {
  it('creates a parent organization with the parent quota plan and its owner membership', async () => {
    const fake = makeFakeFirestore(); const writes: unknown[] = []
    await expect(createParentOrg({ firestore: fake as never, generateOrgId: () => 'parentOrg_fixed-id', writeOrgAccessMirror: async (p) => { writes.push(p) } }, { name: '桜丘市教育委員会', ownerUid: 'uid-1' })).resolves.toEqual({ orgId: 'parentOrg_fixed-id' })
    expect(fake.docs.get('organizations/parentOrg_fixed-id')).toMatchObject({ type: 'parentOrg', name: '桜丘市教育委員会', ownerUid: 'uid-1' })
    expect(fake.docs.get('organizations/parentOrg_fixed-id')).toHaveProperty('planId', 'PARENT_ORG')
    expect(fake.docs.get('organizations/parentOrg_fixed-id/members/uid-1')).toMatchObject({ role: 'owner', status: 'active', membershipVersion: 1 })
    expect(writes).toEqual([{ orgId: 'parentOrg_fixed-id', uid: 'uid-1', role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }])
  })
  it('creates a new organization on every call', async () => { const fake = makeFakeFirestore(); let n = 0; const deps = { firestore: fake as never, generateOrgId: () => `parentOrg_${++n}`, writeOrgAccessMirror: async () => {} }; await createParentOrg(deps, { name: 'A', ownerUid: 'u' }); await createParentOrg(deps, { name: 'B', ownerUid: 'u' }); expect(fake.docs.has('organizations/parentOrg_1')).toBe(true); expect(fake.docs.has('organizations/parentOrg_2')).toBe(true) })
})
