import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { randomUUID } from 'node:crypto'
import type { OrgAccessMirrorPayload } from './personalOrg'

export interface CreateSchoolOrgInput { name: string; ownerUid: string }
export interface CreateSchoolOrgResult { orgId: string }

interface FirestoreTransaction {
  get: (path: string) => Promise<{ exists: boolean }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface CreateSchoolOrgDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<void>) => Promise<void> }
  generateOrgId: () => string
  writeOrgAccessMirror: (payload: OrgAccessMirrorPayload) => Promise<void>
  now?: () => unknown
}

/**
 * Unlike ensurePersonalOrg, school organizations have no one-per-user
 * constraint: each call creates a new organization. Verification always
 * begins as PENDING; promoting it is outside this function's responsibility.
 */
export const createSchoolOrg = async (deps: CreateSchoolOrgDeps, input: CreateSchoolOrgInput): Promise<CreateSchoolOrgResult> => {
  const orgId = deps.generateOrgId()
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const orgPath = `organizations/${orgId}`
  const memberPath = `organizations/${orgId}/members/${input.ownerUid}`

  await deps.firestore.runTransaction(async (tx) => {
    tx.set(orgPath, { type: 'school', name: input.name, verificationStatus: 'PENDING', ownerUid: input.ownerUid, createdAt: nowValue })
    tx.set(memberPath, { role: 'owner', status: 'active', membershipVersion: 1, joinedAt: nowValue })
  })

  await deps.writeOrgAccessMirror({ orgId, uid: input.ownerUid, role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })

  return { orgId }
}

/** Production wiring: Firestore Admin SDK + RTDB Admin SDK. */
export const createSchoolOrgWithAdminSdk = (input: CreateSchoolOrgInput): Promise<CreateSchoolOrgResult> => {
  const db = getFirestore()
  return createSchoolOrg({
    firestore: {
      runTransaction: (fn) => db.runTransaction(async (tx) => fn({
        get: async (path) => ({ exists: (await tx.get(db.doc(path))).exists }),
        set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) },
      })),
    },
    generateOrgId: () => `school_${randomUUID()}`,
    writeOrgAccessMirror: async (payload) => {
      await getDatabase().ref().update({
        [`orgAccess/${payload.orgId}/${payload.uid}`]: {
          role: payload.role,
          status: payload.status,
          membershipVersion: payload.membershipVersion,
          revokedAtSeconds: payload.revokedAtSeconds,
        },
        [`orgAccessMeta/${payload.orgId}/${payload.uid}`]: { syncState: 'SYNCED' },
      })
    },
  }, input)
}
