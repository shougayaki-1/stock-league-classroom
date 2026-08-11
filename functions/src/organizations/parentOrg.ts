import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { randomUUID } from 'node:crypto'
import type { OrgAccessMirrorPayload } from './personalOrg'

export interface CreateParentOrgInput { name: string; ownerUid: string }
export interface CreateParentOrgResult { orgId: string }
interface FirestoreTransaction { set: (path: string, data: Record<string, unknown>) => void }
export interface CreateParentOrgDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<void>) => Promise<void> }
  generateOrgId: () => string
  writeOrgAccessMirror: (payload: OrgAccessMirrorPayload) => Promise<void>
  now?: () => unknown
}
export const createParentOrg = async (deps: CreateParentOrgDeps, input: CreateParentOrgInput): Promise<CreateParentOrgResult> => {
  const orgId = deps.generateOrgId()
  const now = deps.now ? deps.now() : new Date().toISOString()
  await deps.firestore.runTransaction(async (tx) => {
    tx.set(`organizations/${orgId}`, {
      type: 'parentOrg',
      name: input.name,
      ownerUid: input.ownerUid,
      planId: 'PARENT_ORG',
      createdAt: now,
    })
    tx.set(`organizations/${orgId}/members/${input.ownerUid}`, { role: 'owner', status: 'active', membershipVersion: 1, joinedAt: now })
  })
  await deps.writeOrgAccessMirror({ orgId, uid: input.ownerUid, role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
  return { orgId }
}
export const createParentOrgWithAdminSdk = (input: CreateParentOrgInput): Promise<CreateParentOrgResult> => {
  const db = getFirestore()
  return createParentOrg({
    firestore: { runTransaction: (fn) => db.runTransaction(async (tx) => fn({ set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) } })) },
    generateOrgId: () => `parentOrg_${randomUUID()}`,
    writeOrgAccessMirror: async (payload) => { await getDatabase().ref().update({
      [`orgAccess/${payload.orgId}/${payload.uid}`]: { role: payload.role, status: payload.status, membershipVersion: payload.membershipVersion, revokedAtSeconds: payload.revokedAtSeconds },
      [`orgAccessMeta/${payload.orgId}/${payload.uid}`]: { syncState: 'SYNCED' },
    }) },
  }, input)
}
