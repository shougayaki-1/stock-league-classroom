import { describe, expect, it } from 'vitest'
import { createSchoolOrg } from './schoolOrg'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<void>) => fn({
      get: async (path: string) => ({ exists: docs.has(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('createSchoolOrg', () => {
  it('creates a school organization and its owner membership', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const result = await createSchoolOrg({
      firestore: fake as never,
      generateOrgId: () => 'school_fixed-id',
      writeOrgAccessMirror: async (payload) => { rtdbWrites.push(payload) },
    }, { name: '桜丘高校', ownerUid: 'uid-1' })

    expect(result).toEqual({ orgId: 'school_fixed-id' })
    expect(fake.docs.get('organizations/school_fixed-id')).toMatchObject({ type: 'school', name: '桜丘高校', verificationStatus: 'PENDING', ownerUid: 'uid-1' })
    expect(fake.docs.get('organizations/school_fixed-id/members/uid-1')).toMatchObject({ role: 'owner', status: 'active', membershipVersion: 1 })
    expect(rtdbWrites).toEqual([{ orgId: 'school_fixed-id', uid: 'uid-1', role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }])
  })

  it('creates a new organization on every call, unlike ensurePersonalOrg', async () => {
    const fake = makeFakeFirestore()
    let counter = 0
    const generateOrgId = () => `school_${(counter += 1)}`
    await createSchoolOrg({ firestore: fake as never, generateOrgId, writeOrgAccessMirror: async () => {} }, { name: 'A高校', ownerUid: 'uid-1' })
    await createSchoolOrg({ firestore: fake as never, generateOrgId, writeOrgAccessMirror: async () => {} }, { name: 'B高校', ownerUid: 'uid-1' })
    expect(fake.docs.has('organizations/school_1')).toBe(true)
    expect(fake.docs.has('organizations/school_2')).toBe(true)
  })
})
