import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'

export type AiBetaAccessStatus = 'APPROVED' | 'REVOKED'

export interface AiBetaAccessDoc {
  uid: string
  emailSnapshot: string
  status: AiBetaAccessStatus
  approvedAt: unknown
  approvedByUid: string
  revokedAt?: unknown
  revokedByUid?: string
}

export interface AiBetaAccessEventDoc {
  eventId: string
  action: 'GRANTED' | 'REVOKED'
  actorUid: string
  targetUid: string
  targetEmailSnapshot: string
  reason: string
  idempotencyKey: string
  occurredAt: unknown
}

export interface AiBetaAccessListItem {
  teacherUid: string
  email: string
  approvedByUid: string
  approvedAtMillis: number
}

export interface GrantAiBetaAccessInput {
  email: string
  reason: string
  idempotencyKey: string
  actorUid: string
}

export interface RevokeAiBetaAccessInput {
  teacherUid: string
  reason: string
  idempotencyKey: string
  actorUid: string
}

export interface AiBetaAccessMutationResult {
  changed: boolean
  teacherUid: string
  deduplicated: boolean
}

export class AiBetaTargetNotFoundError extends Error {
  constructor(message = 'Target user not found') {
    super(message)
    this.name = 'AiBetaTargetNotFoundError'
  }
}

export class AiBetaTargetIneligibleError extends Error {
  constructor(message = 'Target user is ineligible for AI beta access') {
    super(message)
    this.name = 'AiBetaTargetIneligibleError'
  }
}

export class AiBetaIdempotencyMismatchError extends Error {
  constructor(message = 'Idempotency key reused with different payload') {
    super(message)
    this.name = 'AiBetaIdempotencyMismatchError'
  }
}

export interface AiBetaAccessTransaction {
  get(path: string): Promise<{
    exists: boolean
    data(): Record<string, unknown> | undefined
    get(field: string): unknown
  }>
  set(path: string, data: unknown, options?: unknown): void
}

export interface AiBetaAccessDeps {
  auth: {
    getUserByEmail(email: string): Promise<{
      uid: string
      email?: string
      emailVerified: boolean
      providerData: Array<{ providerId: string }>
    }>
  }
  firestore: {
    runTransaction<T>(fn: (tx: AiBetaAccessTransaction) => Promise<T>): Promise<T>
    listApproved(): Promise<Array<{ id: string; data: Record<string, unknown> }>>
  }
  now: () => unknown
  deleteField: () => unknown
}

export const getAiBetaAccessApproved = async (
  db: FirebaseFirestore.Firestore,
  teacherUid: string,
): Promise<boolean> => {
  const doc = await db.doc(`aiBetaAccess/${teacherUid}`).get()
  return doc.exists && doc.get('status') === 'APPROVED'
}

export const assertAiBetaApproved = async (
  db: FirebaseFirestore.Firestore,
  teacherUid: string,
): Promise<void> => {
  const approved = await getAiBetaAccessApproved(db, teacherUid)
  if (!approved) {
    throw new HttpsError('permission-denied', 'AIベータ機能は運営者の許可が必要です。')
  }
}

export const grantAiBetaAccess = async (
  deps: AiBetaAccessDeps,
  input: GrantAiBetaAccessInput,
): Promise<AiBetaAccessMutationResult> => {
  const normalizedEmail = input.email.trim().toLowerCase()
  const trimmedReason = input.reason.trim()
  const trimmedKey = input.idempotencyKey.trim()

  if (!normalizedEmail || !trimmedReason || !trimmedKey || !input.actorUid.trim()) {
    throw new Error('Invalid arguments for granting AI beta access')
  }

  let user: {
    uid: string
    email?: string
    emailVerified: boolean
    providerData: Array<{ providerId: string }>
  }

  try {
    user = await deps.auth.getUserByEmail(normalizedEmail)
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found' || error?.message?.includes('User not found')) {
      throw new AiBetaTargetNotFoundError(`User with email "${normalizedEmail}" not found.`)
    }
    throw error
  }

  if (
    !user.email ||
    !user.emailVerified ||
    !user.providerData.some((p) => p.providerId === 'google.com')
  ) {
    throw new AiBetaTargetIneligibleError(
      'Target user must have verified email and Google provider.',
    )
  }

  const targetUid = user.uid
  const targetEmailSnapshot = user.email

  const digest = requestDigest({
    action: 'GRANT',
    email: normalizedEmail,
    teacherUid: targetUid,
    reason: trimmedReason,
    actorUid: input.actorUid,
  })

  const docId = idempotencyDocumentId('aiBetaAccess', trimmedKey)

  return deps.firestore.runTransaction(async (tx) => {
    const idempotencySnap = await tx.get(`aiBetaAccessIdempotency/${docId}`)
    if (idempotencySnap.exists) {
      const storedDigest = idempotencySnap.get('digest')
      if (storedDigest !== digest) {
        throw new AiBetaIdempotencyMismatchError(
          'Idempotency key reused with different payload.',
        )
      }
      const storedResult = idempotencySnap.get('result') as {
        changed: boolean
        teacherUid: string
      }
      return {
        changed: storedResult.changed,
        teacherUid: storedResult.teacherUid,
        deduplicated: true,
      }
    }

    const currentAccessSnap = await tx.get(`aiBetaAccess/${targetUid}`)
    const isCurrentlyApproved =
      currentAccessSnap.exists && currentAccessSnap.get('status') === 'APPROVED'

    if (isCurrentlyApproved) {
      tx.set(`aiBetaAccessIdempotency/${docId}`, {
        digest,
        result: { changed: false, teacherUid: targetUid },
        createdAt: deps.now(),
      })
      return {
        changed: false,
        teacherUid: targetUid,
        deduplicated: false,
      }
    }

    tx.set(`aiBetaAccess/${targetUid}`, {
      uid: targetUid,
      emailSnapshot: targetEmailSnapshot,
      status: 'APPROVED',
      approvedAt: deps.now(),
      approvedByUid: input.actorUid,
      revokedAt: deps.deleteField(),
      revokedByUid: deps.deleteField(),
    })

    tx.set(`aiBetaAccessEvents/${docId}`, {
      eventId: docId,
      action: 'GRANTED',
      actorUid: input.actorUid,
      targetUid,
      targetEmailSnapshot,
      reason: trimmedReason,
      idempotencyKey: trimmedKey,
      occurredAt: deps.now(),
    })

    tx.set(`aiBetaAccessIdempotency/${docId}`, {
      digest,
      result: { changed: true, teacherUid: targetUid },
      createdAt: deps.now(),
    })

    return {
      changed: true,
      teacherUid: targetUid,
      deduplicated: false,
    }
  })
}

export const revokeAiBetaAccess = async (
  deps: AiBetaAccessDeps,
  input: RevokeAiBetaAccessInput,
): Promise<AiBetaAccessMutationResult> => {
  const teacherUid = input.teacherUid.trim()
  const trimmedReason = input.reason.trim()
  const trimmedKey = input.idempotencyKey.trim()

  if (!teacherUid || !trimmedReason || !trimmedKey || !input.actorUid.trim()) {
    throw new Error('Invalid arguments for revoking AI beta access')
  }

  const digest = requestDigest({
    action: 'REVOKE',
    teacherUid,
    reason: trimmedReason,
    actorUid: input.actorUid,
  })

  const docId = idempotencyDocumentId('aiBetaAccess', trimmedKey)

  return deps.firestore.runTransaction(async (tx) => {
    const idempotencySnap = await tx.get(`aiBetaAccessIdempotency/${docId}`)
    if (idempotencySnap.exists) {
      const storedDigest = idempotencySnap.get('digest')
      if (storedDigest !== digest) {
        throw new AiBetaIdempotencyMismatchError(
          'Idempotency key reused with different payload.',
        )
      }
      const storedResult = idempotencySnap.get('result') as {
        changed: boolean
        teacherUid: string
      }
      return {
        changed: storedResult.changed,
        teacherUid: storedResult.teacherUid,
        deduplicated: true,
      }
    }

    const currentAccessSnap = await tx.get(`aiBetaAccess/${teacherUid}`)
    const isCurrentlyApproved =
      currentAccessSnap.exists && currentAccessSnap.get('status') === 'APPROVED'

    if (!isCurrentlyApproved) {
      tx.set(`aiBetaAccessIdempotency/${docId}`, {
        digest,
        result: { changed: false, teacherUid },
        createdAt: deps.now(),
      })
      return {
        changed: false,
        teacherUid,
        deduplicated: false,
      }
    }

    const targetEmailSnapshot = (currentAccessSnap.get('emailSnapshot') as string) || ''

    tx.set(
      `aiBetaAccess/${teacherUid}`,
      {
        status: 'REVOKED',
        revokedAt: deps.now(),
        revokedByUid: input.actorUid,
      },
      { merge: true },
    )

    tx.set(`aiBetaAccessEvents/${docId}`, {
      eventId: docId,
      action: 'REVOKED',
      actorUid: input.actorUid,
      targetUid: teacherUid,
      targetEmailSnapshot,
      reason: trimmedReason,
      idempotencyKey: trimmedKey,
      occurredAt: deps.now(),
    })

    tx.set(`aiBetaAccessIdempotency/${docId}`, {
      digest,
      result: { changed: true, teacherUid },
      createdAt: deps.now(),
    })

    return {
      changed: true,
      teacherUid,
      deduplicated: false,
    }
  })
}

export const listApprovedAiBetaAccess = async (
  deps: Pick<AiBetaAccessDeps, 'firestore'>,
): Promise<AiBetaAccessListItem[]> => {
  const docs = await deps.firestore.listApproved()
  return docs.map((item) => {
    const rawTime = item.data.approvedAt as any
    const approvedAtMillis =
      typeof rawTime?.toMillis === 'function'
        ? rawTime.toMillis()
        : typeof rawTime === 'number'
          ? rawTime
          : 0

    return {
      teacherUid: item.id,
      email: (item.data.emailSnapshot as string) || '',
      approvedByUid: (item.data.approvedByUid as string) || '',
      approvedAtMillis,
    }
  })
}

export const getAiBetaAccessDepsWithAdminSdk = (): AiBetaAccessDeps => {
  const auth = getAuth()
  const db = getFirestore()

  return {
    auth: {
      getUserByEmail: async (email: string) => {
        const user = await auth.getUserByEmail(email)
        return {
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          providerData: user.providerData,
        }
      },
    },
    firestore: {
      runTransaction: async <T>(fn: (tx: AiBetaAccessTransaction) => Promise<T>): Promise<T> => {
        return db.runTransaction(async (adminTx) => {
          const tx: AiBetaAccessTransaction = {
            get: async (path: string) => {
              const snap = await adminTx.get(db.doc(path))
              return {
                exists: snap.exists,
                data: () => snap.data(),
                get: (field: string) => snap.get(field),
              }
            },
            set: (path: string, data: unknown, options?: unknown) => {
              if (options) {
                adminTx.set(db.doc(path), data as any, options as any)
              } else {
                adminTx.set(db.doc(path), data as any)
              }
            },
          }
          return fn(tx)
        })
      },
      listApproved: async () => {
        const snap = await db
          .collection('aiBetaAccess')
          .where('status', '==', 'APPROVED')
          .orderBy('approvedAt', 'desc')
          .get()
        return snap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data() as Record<string, unknown>,
        }))
      },
    },
    now: () => FieldValue.serverTimestamp(),
    deleteField: () => FieldValue.delete(),
  }
}
