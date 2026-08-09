import { randomBytes, randomUUID } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { validateSocialStudiesMarketContent } from '../market/templateValidation'
import { validateHomeEconomicsContent } from '../homeEconomics/templateValidation'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  countActiveLessonRuns: (orgId: string) => Promise<number>
  set: (path: string, data: Record<string, unknown>) => void
}

/** lessonRunsの`status`のうち、まだ市場・教室資源を使用中とみなす値。COMPLETED/ABORTED/ARCHIVEDのみ枠を解放する。 */
export const ACTIVE_LESSON_RUN_STATUSES = ['DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'REFLECTION'] as const
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

    const content = version.content as { subject: string; socialStudiesMarket?: unknown }
    if (content.subject === 'SOCIAL_STUDIES' && content.socialStudiesMarket) {
      const result = validateSocialStudiesMarketContent(
        content.socialStudiesMarket as Parameters<typeof validateSocialStudiesMarketContent>[0],
      )
      if (!result.valid) throw new Error(result.errors[0])
    }

    const contentWithHomeEconomics = version.content as { subject: string; homeEconomics?: unknown }
    if (contentWithHomeEconomics.subject === 'HOME_ECONOMICS' && contentWithHomeEconomics.homeEconomics) {
      const result = validateHomeEconomicsContent(
        contentWithHomeEconomics.homeEconomics as Parameters<typeof validateHomeEconomicsContent>[0],
      )
      if (!result.valid) throw new Error(result.errors[0])
    }

    const orgSnap = await tx.get(`organizations/${deps.orgId}`)
    const org = orgSnap.exists ? (orgSnap.data() as { planId?: string }) : undefined
    if (!org?.planId) throw new Error('この組織にはプランが設定されていません')
    const planSnap = await tx.get(`planDefinitions/${org.planId}`)
    if (!planSnap.exists) throw new Error('この組織にはプランが設定されていません')
    const plan = planSnap.data() as { limits: { concurrentLessonsAndMarkets: number } }
    const activeCount = await tx.countActiveLessonRuns(deps.orgId)
    if (activeCount >= plan.limits.concurrentLessonsAndMarkets) {
      throw new Error('この組織の同時授業・市場数の上限に達しています')
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
        countActiveLessonRuns: async (orgId) => {
          const snap = await tx.get(
            db.collection('lessonRuns').where('orgId', '==', orgId).where('status', 'in', ACTIVE_LESSON_RUN_STATUSES),
          )
          return snap.size
        },
        set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) },
      })),
    },
    generateRandomSeed, generateLessonRunId: randomUUID, ...input,
  })
}
