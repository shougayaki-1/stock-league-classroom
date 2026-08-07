import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { personalOrgId } from '../lib/personalOrgId'

export interface OrgAccessMirrorPayload {
  orgId: string
  uid: string
  role: 'owner'
  status: 'active'
  membershipVersion: number
  revokedAtSeconds: number
}

interface FirestoreTransaction {
  get: (path: string) => Promise<{ exists: boolean }>
  set: (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => void
}
export interface EnsurePersonalOrgDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<boolean>) => Promise<boolean> }
  writeOrgAccessMirror: (payload: OrgAccessMirrorPayload) => Promise<void>
  /**
   * Returns whether an RTDB mirror entry already exists for (orgId, uid).
   * Used to recover from a torn create (see ensurePersonalOrg's doc comment):
   * on a retry where `created` is false, we still must not skip the mirror
   * write if the mirror is missing entirely.
   */
  mirrorExists: (orgId: string, uid: string) => Promise<boolean>
  now?: () => unknown
}
export interface EnsurePersonalOrgResult { orgId: string; created: boolean }

/**
 * Idempotent: Firestore is the system of record, so a retry after a partial
 * failure (e.g. the RTDB mirror write below fails) simply re-reads the
 * existing org and reports created: false — never creates a duplicate org,
 * per design.md:99's "既に個人組織がある → 既存のorgIdを返す".
 *
 * The RTDB mirror write happens when `created` is true (i.e. this call is
 * the one that actually created the org/membership docs), OR when the
 * mirror entry is currently absent — the latter recovers from a torn
 * create, where a prior call's Firestore transaction committed but its
 * writeOrgAccessMirror call then threw (e.g. a transient RTDB failure).
 * Without this, every subsequent retry would report created: false and skip
 * the mirror write forever, leaving that teacher with a Firestore org but no
 * RTDB mirror at all — unrecoverable without manual intervention, since no
 * other writer of orgAccess/orgAccessMeta exists yet in Phase A
 * (syncOrganizationMembershipChange has no Admin SDK wiring yet, by design).
 *
 * This must NOT re-apply the mirror once it already exists: this Callable
 * has no idempotency guard and is reachable by any verified teacher at any
 * time, so unconditionally re-applying hardcoded
 * `{ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }`
 * values here would silently overwrite whatever state
 * syncOrganizationMembershipChange's PENDING→SYNCED protocol has since
 * established (e.g. a suspension) — bypassing Firestore, the system of
 * record, and every RTDB rule that trusts the mirror. Once the mirror
 * exists, its ongoing state is syncOrganizationMembershipChange's
 * responsibility, not this function's.
 */
export const ensurePersonalOrg = async (uid: string, deps: EnsurePersonalOrgDeps): Promise<EnsurePersonalOrgResult> => {
  const orgId = personalOrgId(uid)
  const orgPath = `organizations/${orgId}`
  const memberPath = `organizations/${orgId}/members/${uid}`
  const userPath = `users/${uid}`
  const nowValue = deps.now ? deps.now() : new Date().toISOString()

  const created = await deps.firestore.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgPath)
    if (orgSnap.exists) return false
    tx.set(orgPath, { type: 'personal', ownerUid: uid, createdAt: nowValue })
    tx.set(memberPath, { role: 'owner', status: 'active', membershipVersion: 1, joinedAt: nowValue })
    tx.set(userPath, { personalOrgId: orgId }, { merge: true })
    return true
  })

  const shouldWriteMirror = created || !(await deps.mirrorExists(orgId, uid))
  if (shouldWriteMirror) {
    await deps.writeOrgAccessMirror({ orgId, uid, role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
  }

  return { orgId, created }
}

/** Production wiring: Firestore Admin SDK + RTDB Admin SDK. */
export const ensurePersonalOrgWithAdminSdk = (uid: string): Promise<EnsurePersonalOrgResult> => {
  const db = getFirestore()
  return ensurePersonalOrg(uid, {
    firestore: {
      runTransaction: (fn) => db.runTransaction(async (tx) => fn({
        get: async (path) => ({ exists: (await tx.get(db.doc(path))).exists }),
        set: (path, data, options) => { tx.set(db.doc(path), path === `users/${uid}` ? data : { ...data, createdAt: FieldValue.serverTimestamp() }, options ?? { merge: true }) },
      })),
    },
    mirrorExists: async (orgId, mirrorUid) => {
      const snap = await getDatabase().ref(`orgAccess/${orgId}/${mirrorUid}`).once('value')
      return snap.exists()
    },
    // Writes both the orgAccess entry and its syncState in one atomic
    // multi-location update, matching the convergence contract that
    // syncOrganizationMembershipChange's commitMirrorSynced also relies on —
    // no separate path ever writes RTDB with a stale/missing syncState.
    writeOrgAccessMirror: async (payload) => {
      await getDatabase().ref().update({
        [`orgAccess/${payload.orgId}/${payload.uid}`]: {
          role: payload.role,
          status: payload.status,
          membershipVersion: payload.membershipVersion,
          revokedAtSeconds: payload.revokedAtSeconds,
        },
        [`orgAccessMeta/${payload.orgId}/${payload.uid}`]: {
          membershipVersion: payload.membershipVersion,
          syncState: 'SYNCED',
        },
      })
    },
    now: () => FieldValue.serverTimestamp(),
  })
}
