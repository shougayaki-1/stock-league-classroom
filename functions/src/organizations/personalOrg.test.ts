import { describe, expect, it, vi } from 'vitest'
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
      mirrorExists: async () => false,
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

  it('is idempotent: a second call makes no further Firestore writes and does not touch the RTDB mirror when the mirror already exists', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const writeOrgAccessMirror = vi.fn(async (payload: unknown) => { rtdbWrites.push(payload) })
    // The mirror was already written by the first call, so on retry it
    // exists — this is the normal, non-torn-create case.
    const mirrorExists = vi.fn(async () => true)
    const deps = { firestore: fake as never, writeOrgAccessMirror, mirrorExists }
    await ensurePersonalOrg('uid-1', deps)
    expect(writeOrgAccessMirror).toHaveBeenCalledTimes(1)
    const before = fake.docs.size
    const second = await ensurePersonalOrg('uid-1', deps)
    expect(second).toEqual({ orgId: 'personal_uid-1', created: false })
    expect(fake.docs.size).toBe(before)
    // The RTDB mirror must NOT be re-applied when the org already existed
    // AND the mirror is already present: syncOrganizationMembershipChange's
    // PENDING->SYNCED protocol owns the mirror's ongoing state (e.g. a
    // suspension) once the org exists, and a client-callable retry here must
    // never reset it back to hardcoded owner/active/v1 values. Assert the
    // write function was never invoked again on this idempotent-retry path.
    expect(writeOrgAccessMirror).toHaveBeenCalledTimes(1)
    expect(rtdbWrites).toHaveLength(1)
  })

  it('repairs a torn create: if the org already exists in Firestore but the RTDB mirror is absent, it writes the mirror once', async () => {
    // Simulates a prior call whose Firestore transaction committed (org +
    // membership created) but whose writeOrgAccessMirror call then threw
    // (e.g. a transient RTDB failure) before this deps object observed it.
    // Every retry from here on reports created: false, and without a
    // mirror-existence check this teacher would be stuck forever with a
    // Firestore org but no RTDB mirror.
    const fake = makeFakeFirestore()
    fake.docs.set('organizations/personal_uid-1', { type: 'personal', ownerUid: 'uid-1' })
    const rtdbWrites: unknown[] = []
    const writeOrgAccessMirror = vi.fn(async (payload: unknown) => { rtdbWrites.push(payload) })
    const mirrorExists = vi.fn(async () => false)
    const deps = { firestore: fake as never, writeOrgAccessMirror, mirrorExists }

    const result = await ensurePersonalOrg('uid-1', deps)

    expect(result).toEqual({ orgId: 'personal_uid-1', created: false })
    expect(writeOrgAccessMirror).toHaveBeenCalledTimes(1)
    expect(rtdbWrites).toEqual([{ orgId: 'personal_uid-1', uid: 'uid-1', role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }])
  })
})
