import { describe, expect, it } from 'vitest'
import { ensurePersonalOrg } from './personalOrg'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<boolean>) => fn({
      get: async (path: string) => ({ exists: docs.has(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('ensurePersonalOrg', () => {
  it('creates the org, membership, and users doc exactly once', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const result = await ensurePersonalOrg('uid-1', {
      firestore: fake as never,
      writeOrgAccessMirror: async (payload) => { rtdbWrites.push(payload) },
    })
    expect(result).toEqual({ orgId: 'personal_uid-1', created: true })
    expect(fake.docs.get('organizations/personal_uid-1')).toMatchObject({ type: 'personal', ownerUid: 'uid-1' })
    expect(fake.docs.get('organizations/personal_uid-1/members/uid-1')).toMatchObject({ role: 'owner', status: 'active', membershipVersion: 1 })
    expect(fake.docs.get('users/uid-1')).toMatchObject({ personalOrgId: 'personal_uid-1' })
    // membershipVersion mirrors the Firestore membership doc (Task 4's rules
    // already expect that field on the member doc); revokedAtSeconds is set
    // from creation so the integration spec's §6.6 field is never absent.
    expect(rtdbWrites).toEqual([{ orgId: 'personal_uid-1', uid: 'uid-1', role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }])
  })

  it('is idempotent: a second call makes no further Firestore writes', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const deps = { firestore: fake as never, writeOrgAccessMirror: async (payload: unknown) => { rtdbWrites.push(payload) } }
    await ensurePersonalOrg('uid-1', deps)
    const before = fake.docs.size
    const second = await ensurePersonalOrg('uid-1', deps)
    expect(second).toEqual({ orgId: 'personal_uid-1', created: false })
    expect(fake.docs.size).toBe(before)
    // The RTDB mirror is re-applied unconditionally on every call — that is
    // deliberately safe because it always writes the same values.
    expect(rtdbWrites).toHaveLength(2)
  })
})
