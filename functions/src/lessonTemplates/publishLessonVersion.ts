import { randomUUID } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

interface FirestoreTransaction {
  get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  set: (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => void
}

export interface PublishLessonVersionDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<PublishLessonVersionResult>) => Promise<PublishLessonVersionResult> }
  randomUUID: () => string
  now?: () => unknown
}

export interface PublishLessonVersionInput {
  templateId: string
  /** Resolved server-side from the template's own stored orgId — never client input. */
  orgId: string
  uid: string
  changeSummary?: string
  idempotencyKey: string
}

export interface PublishLessonVersionResult {
  versionId: string
  /** True when this call replayed an already-published idempotency key rather than creating a new version. */
  alreadyPublished: boolean
}

/**
 * Publishes the template's current draft as a new immutable LessonVersion and
 * advances the template's currentPublishedVersionId/status pointer — all
 * within a single Firestore transaction, so a partial failure can never leave
 * a version without a matching pointer update (or vice versa).
 *
 * Idempotent by (orgId, idempotencyKey): a retry with the same request
 * payload replays the stored versionId without creating a second version. A
 * retry under the same key with a different payload is rejected outright
 * rather than silently succeeding against the wrong draft.
 */
export const publishLessonVersion = (deps: PublishLessonVersionDeps, input: PublishLessonVersionInput): Promise<PublishLessonVersionResult> => {
  const idempotencyPath = `lessonVersionPublishIdempotency/${idempotencyDocumentId(input.orgId, input.idempotencyKey)}`
  // uid is included so two different teachers in the same org cannot reuse
  // the same idempotency key against the same template and replay each
  // other's result (Finding 4).
  const requestDigest = computeRequestDigest({ templateId: input.templateId, changeSummary: input.changeSummary ?? null, createdByUid: input.uid })
  const templatePath = `lessonTemplates/${input.templateId}`
  const now = deps.now ? deps.now() : new Date().toISOString()

  return deps.firestore.runTransaction(async (tx) => {
    const idempotencySnap = await tx.get(idempotencyPath)
    if (idempotencySnap.exists) {
      if (idempotencySnap.data?.requestDigest !== requestDigest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return { versionId: idempotencySnap.data?.versionId as string, alreadyPublished: true }
    }

    const templateSnap = await tx.get(templatePath)
    if (!templateSnap.exists || !templateSnap.data) {
      throw new Error('Lesson template not found')
    }
    if (templateSnap.data.orgId !== input.orgId) {
      throw new Error('Lesson template does not belong to the expected organization')
    }

    const versionId = deps.randomUUID()
    const versionPath = `${templatePath}/versions/${versionId}`
    const previousVersionId = templateSnap.data.currentPublishedVersionId as string | null

    tx.set(versionPath, {
      id: versionId,
      templateId: input.templateId,
      orgId: input.orgId,
      schemaVersion: (templateSnap.data.draft as { schemaVersion: number }).schemaVersion,
      content: templateSnap.data.draft,
      createdByUid: input.uid,
      createdAt: now,
      ...(input.changeSummary !== undefined ? { changeSummary: input.changeSummary } : {}),
      ...(previousVersionId ? { parentVersionId: previousVersionId } : {}),
      immutable: true,
    })
    tx.set(templatePath, { currentPublishedVersionId: versionId, status: 'READY', updatedAt: now }, { merge: true })
    tx.set(idempotencyPath, { requestDigest, versionId, createdAt: now })

    return { versionId, alreadyPublished: false }
  })
}

/** Production wiring: Firestore Admin SDK transaction + Node's crypto. */
export const publishLessonVersionWithAdminSdk = (input: PublishLessonVersionInput): Promise<PublishLessonVersionResult> => {
  const db = getFirestore()
  return publishLessonVersion({
    firestore: {
      runTransaction: (fn) => db.runTransaction(async (tx) => fn({
        get: async (path) => {
          const snap = await tx.get(db.doc(path))
          return { exists: snap.exists, data: snap.data() }
        },
        set: (path, data, options) => { tx.set(db.doc(path), data, options ?? { merge: false }) },
      })),
    },
    randomUUID: () => randomUUID(),
    now: () => FieldValue.serverTimestamp(),
  }, input)
}
