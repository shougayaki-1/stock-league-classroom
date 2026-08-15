import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { isMarketplaceVisibility, type MarketplaceVisibility } from './marketplaceVisibility'

export type TemplateCertificationLevel = 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'

export interface SetTemplateCertificationInput {
  templateId: string
  versionId: string
  level: TemplateCertificationLevel
  reason: string
  idempotencyKey: string
  actorUid: string
}

export interface SetTemplateCertificationResult {
  visibility: TemplateCertificationLevel
  changed: boolean
  deduplicated: boolean
}

export interface TemplateVersionCertificationDoc {
  templateId: string
  versionId: string
  level: 'VERIFIED' | 'OFFICIAL' | null
  grantedByUid: string | null
  grantedAt: unknown | null
  revokedByUid: string | null
  revokedAt: unknown | null
  reason: string | null
  updatedAt: unknown
}

export interface TemplateCertificationEventDoc {
  templateId: string
  versionId: string
  previousVisibility: MarketplaceVisibility
  nextVisibility: MarketplaceVisibility
  actorUid: string
  reason: string
  createdAt: unknown
}

interface FirestoreTransaction {
  get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  set: (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => void
}

export interface SetTemplateCertificationDeps {
  firestore: {
    runTransaction: (
      fn: (tx: FirestoreTransaction) => Promise<SetTemplateCertificationResult>,
    ) => Promise<SetTemplateCertificationResult>
  }
  now?: () => unknown
}

export const setTemplateCertification = async (
  deps: SetTemplateCertificationDeps,
  input: SetTemplateCertificationInput,
): Promise<SetTemplateCertificationResult> => {
  const trimmedReason = input.reason ? input.reason.trim() : ''
  if (trimmedReason.length < 1 || trimmedReason.length > 500) {
    throw new Error('reason must be between 1 and 500 characters')
  }

  const idempotencyKeyId = idempotencyDocumentId(input.templateId, input.idempotencyKey)
  const idempotencyPath = `templateCertificationIdempotency/${idempotencyKeyId}`
  const requestDigest = computeRequestDigest({
    templateId: input.templateId,
    versionId: input.versionId,
    level: input.level,
    reason: trimmedReason,
    actorUid: input.actorUid,
  })

  const templatePath = `lessonTemplates/${input.templateId}`
  const versionPath = `${templatePath}/versions/${input.versionId}`
  const certPath = `templateVersionCertifications/${input.templateId}__${input.versionId}`
  const eventPath = `templateCertificationEvents/${idempotencyKeyId}`
  const now = deps.now ? deps.now() : new Date().toISOString()

  return deps.firestore.runTransaction(async (tx) => {
    // 1. Check idempotency
    const idempotencySnap = await tx.get(idempotencyPath)
    if (idempotencySnap.exists) {
      if (idempotencySnap.data?.requestDigest !== requestDigest) {
        throw new Error('Idempotency key payload mismatch')
      }
      const storedResult = idempotencySnap.data?.result as {
        visibility: TemplateCertificationLevel
        changed: boolean
      }
      return {
        visibility: storedResult.visibility,
        changed: storedResult.changed,
        deduplicated: true,
      }
    }

    // 2. Read template
    const templateSnap = await tx.get(templatePath)
    if (!templateSnap.exists || !templateSnap.data) {
      throw new Error('Lesson template not found')
    }

    const currentVisibility = templateSnap.data.visibility
    if (!isMarketplaceVisibility(currentVisibility)) {
      throw new Error('Lesson template is not published to marketplace')
    }

    if (templateSnap.data.currentPublishedVersionId !== input.versionId) {
      throw new Error('Target version is not current published version')
    }

    // 3. Read version (validate existence without modifying)
    const versionSnap = await tx.get(versionPath)
    if (!versionSnap.exists || !versionSnap.data) {
      throw new Error('Lesson version not found')
    }

    const previousVisibility = currentVisibility as TemplateCertificationLevel
    const nextVisibility = input.level

    // If no change in visibility
    if (previousVisibility === nextVisibility) {
      const result = { visibility: nextVisibility, changed: false }
      tx.set(idempotencyPath, {
        requestDigest,
        result,
        createdAt: now,
      })
      return {
        visibility: nextVisibility,
        changed: false,
        deduplicated: false,
      }
    }

    // Visibility changed: execute atomic updates
    tx.set(
      templatePath,
      {
        visibility: nextVisibility,
        updatedAt: now,
      },
      { merge: true },
    )

    const certDoc: TemplateVersionCertificationDoc =
      nextVisibility === 'COMMUNITY'
        ? {
            templateId: input.templateId,
            versionId: input.versionId,
            level: null,
            grantedByUid: null,
            grantedAt: null,
            revokedByUid: input.actorUid,
            revokedAt: now,
            reason: trimmedReason,
            updatedAt: now,
          }
        : {
            templateId: input.templateId,
            versionId: input.versionId,
            level: nextVisibility,
            grantedByUid: input.actorUid,
            grantedAt: now,
            revokedByUid: null,
            revokedAt: null,
            reason: trimmedReason,
            updatedAt: now,
          }

    tx.set(certPath, certDoc as unknown as Record<string, unknown>, { merge: true })

    const eventDoc: TemplateCertificationEventDoc = {
      templateId: input.templateId,
      versionId: input.versionId,
      previousVisibility,
      nextVisibility,
      actorUid: input.actorUid,
      reason: trimmedReason,
      createdAt: now,
    }

    tx.set(eventPath, eventDoc as unknown as Record<string, unknown>)

    const result = { visibility: nextVisibility, changed: true }
    tx.set(idempotencyPath, {
      requestDigest,
      result,
      createdAt: now,
    })

    return {
      visibility: nextVisibility,
      changed: true,
      deduplicated: false,
    }
  })
}

/** Production wiring using Firestore Admin SDK */
export const setTemplateCertificationWithAdminSdk = (
  input: SetTemplateCertificationInput,
): Promise<SetTemplateCertificationResult> => {
  const db = getFirestore()
  return setTemplateCertification(
    {
      firestore: {
        runTransaction: (fn) =>
          db.runTransaction(async (tx) =>
            fn({
              get: async (path) => {
                const snap = await tx.get(db.doc(path))
                return { exists: snap.exists, data: snap.data() }
              },
              set: (path, data, options) => {
                tx.set(db.doc(path), data, options ?? { merge: false })
              },
            }),
          ),
      },
      now: () => FieldValue.serverTimestamp(),
    },
    input,
  )
}
