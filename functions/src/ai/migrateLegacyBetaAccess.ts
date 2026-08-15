import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'

export interface LegacyAiBetaAccessMigrationResult {
  scanned: number
  alreadyMigrated: number
  eligible: number
  migrated: number
  invalidAuthUser: number
}

export interface LegacyAiBetaAccessMigrationDeps {
  auth: {
    getUser(uid: string): Promise<{
      uid: string
      email?: string
      emailVerified: boolean
      providerData: Array<{ providerId: string }>
    }>
  }
  firestore: {
    listAll(): Promise<Array<{ id: string; data: Record<string, unknown> }>>
    runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
  }
  now: () => unknown
}

export const migrateLegacyAiBetaAccess = async (
  deps: LegacyAiBetaAccessMigrationDeps,
  options: { dryRun: boolean },
): Promise<LegacyAiBetaAccessMigrationResult> => {
  const docs = await deps.firestore.listAll()
  const result: LegacyAiBetaAccessMigrationResult = {
    scanned: docs.length,
    alreadyMigrated: 0,
    eligible: 0,
    migrated: 0,
    invalidAuthUser: 0,
  }

  for (const doc of docs) {
    const data = doc.data
    const uid = doc.id
    if (data.status === 'APPROVED' || data.status === 'REVOKED') {
      result.alreadyMigrated += 1
      continue
    }

    let user: {
      uid: string
      email?: string
      emailVerified: boolean
      providerData: Array<{ providerId: string }>
    }

    try {
      user = await deps.auth.getUser(uid)
    } catch {
      result.invalidAuthUser += 1
      continue
    }

    if (
      !user.email ||
      !user.emailVerified ||
      !user.providerData.some((p) => p.providerId === 'google.com')
    ) {
      result.invalidAuthUser += 1
      continue
    }

    result.eligible += 1

    if (!options.dryRun) {
      const syntheticKey = `migration:legacy-ai-beta:${uid}`
      const docId = idempotencyDocumentId('aiBetaAccess', syntheticKey)
      const actorUid = (data.approvedByUid as string) || 'migration:system'
      const occurredAt = data.approvedAt || deps.now()
      const reason = 'Legacy AI beta access migration'
      const email = user.email.toLowerCase()

      const digest = requestDigest({
        action: 'GRANT',
        email,
        teacherUid: uid,
        reason,
        actorUid,
      })

      await deps.firestore.runTransaction(async (tx) => {
        const idempotencySnap = await tx.get(`aiBetaAccessIdempotency/${docId}`)
        if (idempotencySnap.exists) {
          return
        }

        tx.set(`aiBetaAccess/${uid}`, {
          uid,
          emailSnapshot: user.email,
          status: 'APPROVED',
          approvedAt: occurredAt,
          approvedByUid: actorUid,
        })

        tx.set(`aiBetaAccessEvents/${docId}`, {
          eventId: docId,
          action: 'GRANTED',
          actorUid,
          targetUid: uid,
          targetEmailSnapshot: user.email,
          reason,
          idempotencyKey: syntheticKey,
          occurredAt,
        })

        tx.set(`aiBetaAccessIdempotency/${docId}`, {
          digest,
          result: { changed: true, teacherUid: uid },
          createdAt: deps.now(),
        })
      })

      result.migrated += 1
    }
  }

  return result
}

const getMigrationDepsWithAdminSdk = (): LegacyAiBetaAccessMigrationDeps => {
  const auth = getAuth()
  const db = getFirestore()

  return {
    auth: {
      getUser: async (uid: string) => {
        const user = await auth.getUser(uid)
        return {
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          providerData: user.providerData,
        }
      },
    },
    firestore: {
      listAll: async () => {
        const snap = await db.collection('aiBetaAccess').get()
        return snap.docs.map((d) => ({
          id: d.id,
          data: d.data(),
        }))
      },
      runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
        return db.runTransaction(async (adminTx) => {
          const tx = {
            get: async (path: string) => {
              const snap = await adminTx.get(db.doc(path))
              return {
                exists: snap.exists,
                data: () => snap.data(),
                get: (f: string) => snap.get(f),
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
    },
    now: () => FieldValue.serverTimestamp(),
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const isApply = args.includes('--apply')

  if ((!isDryRun && !isApply) || (isDryRun && isApply)) {
    console.error('Usage: node migrateLegacyBetaAccess.js [--dry-run | --apply]')
    process.exit(1)
  }

  if (getApps().length === 0) {
    initializeApp()
  }

  const deps = getMigrationDepsWithAdminSdk()
  migrateLegacyAiBetaAccess(deps, { dryRun: isDryRun })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2))
      process.exit(0)
    })
    .catch((err) => {
      console.error('Migration failed:', err)
      process.exit(1)
    })
}
