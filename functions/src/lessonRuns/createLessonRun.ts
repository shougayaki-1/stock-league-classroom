import { randomBytes, randomUUID } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
}
export interface CreateLessonRunDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTx) => Promise<string>) => Promise<string> }
  generateRandomSeed: () => string
  generateLessonRunId: () => string
  lessonRunIdempotencyKey: string
  orgId: string
  templateId: string
  primaryTeacherUid: string
  now?: () => unknown
}
export interface CreateLessonRunResult { lessonRunId: string; created: boolean }

/**
 * Idempotent per (orgId, lessonRunIdempotencyKey): a lookup document at
 * `lessonRunIdempotency/{sha256(orgId + '\0' + key)}` records which lessonRunId a
 * given client-supplied key already produced. Hashing prevents `/`, length,
 * and information-disclosure problems from using the raw key as a path.
 * §12.13's "同一キーは1回だけ処理する" applied to run creation (§18.9's
 * quota-reservation pattern generalizes the same way).
 */
export const createLessonRun = async (deps: CreateLessonRunDeps): Promise<CreateLessonRunResult> => {
  const idempotencyPath = `lessonRunIdempotency/${idempotencyDocumentId(deps.orgId, deps.lessonRunIdempotencyKey)}`
  const requestDigest = computeRequestDigest({
    orgId: deps.orgId,
    templateId: deps.templateId,
    primaryTeacherUid: deps.primaryTeacherUid,
  })
  const nowValue = deps.now ? deps.now() : new Date().toISOString()

  return deps.firestore.runTransaction(async (tx) => {
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { lessonRunId: string; requestDigest: string }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ lessonRunId: prior.lessonRunId, created: false })
    }
    const templateSnap = await tx.get(`lessonTemplates/${deps.templateId}`)
    if (!templateSnap.exists) throw new Error('LessonTemplate not found')
    const template = templateSnap.data() as { orgId: string; currentPublishedVersionId: string | null }
    if (template.orgId !== deps.orgId) throw new Error('Template does not belong to this organization')
    if (!template.currentPublishedVersionId) throw new Error('Template has no published version to snapshot')
    const versionSnap = await tx.get(`lessonTemplates/${deps.templateId}/versions/${template.currentPublishedVersionId}`)
    if (!versionSnap.exists) throw new Error('Published version not found')
    const version = versionSnap.data() as { templateId: string; orgId: string; content: unknown }
    if (version.templateId !== deps.templateId || version.orgId !== deps.orgId) {
      throw new Error('Published version pointer mismatch')
    }

    const lessonRunId = deps.generateLessonRunId()
    tx.set(`lessonRuns/${lessonRunId}`, {
      orgId: deps.orgId, templateId: deps.templateId, templateVersionId: template.currentPublishedVersionId,
      templateSnapshot: version.content, subject: (version.content as { subject: string }).subject,
      status: 'DRAFT', primaryTeacherUid: deps.primaryTeacherUid, teacherRoles: { [deps.primaryTeacherUid]: 'PRIMARY' },
      currentPhaseId: null, randomSeed: deps.generateRandomSeed(), restoreGeneration: 0,
      startedAt: null, endedAt: null, createdAt: nowValue,
    })
    tx.set(idempotencyPath, { lessonRunId, requestDigest, createdAt: nowValue })
    return JSON.stringify({ lessonRunId, created: true })
  }).then((raw) => JSON.parse(raw) as CreateLessonRunResult)
}

/** Cryptographically random, generated once server-side. Never Math.random(). */
export const generateRandomSeed = (): string => randomBytes(16).toString('hex')

/** Production wiring: Firestore Admin SDK transaction + Node's crypto. */
export const createLessonRunWithAdminSdk = (input: {
  orgId: string; templateId: string; primaryTeacherUid: string; lessonRunIdempotencyKey: string
}): Promise<CreateLessonRunResult> => {
  const db = getFirestore()
  return createLessonRun({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) },
      })),
    },
    generateRandomSeed, generateLessonRunId: randomUUID, ...input,
  })
}
