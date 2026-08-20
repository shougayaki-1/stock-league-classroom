import { randomBytes, randomUUID } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { validateSocialStudiesMarketContent } from '../market/templateValidation'
import { validateHomeEconomicsContent } from '../homeEconomics/templateValidation'
import { buildDefaultPhases } from './phases/defaultPhases'
import { canIncreaseLimitedResource, type DowngradeStatus } from '../organizations/downgradeEnforcement'
import {
  reserveSharedQuota,
  type QuotaReservation,
  type SchoolQuotaAllocation,
} from '../organizations/parentOrgQuota'
import { ACTIVE_LESSON_RUN_STATUSES, getDowngradeStatusWithAdminSdk } from '../organizations/planLimits'
import { assertParentContractAllowsSharedQuota, parentContractStateFrom } from '../organizations/parentContract'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  getCollection: (path: string) => Promise<Array<{ id: string; data: () => Record<string, unknown> }>>
  countActiveLessonRuns: (orgId: string) => Promise<number>
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
  getDowngradeStatus?: (orgId: string) => Promise<DowngradeStatus>
  now?: () => unknown
  expectedParticipants?: number
}

/** 全プラン共通のサービス上限。プランで変えるのは同時開催数(concurrentLessonsAndMarkets)であり、これではない。 */
export const MAX_PARTICIPANTS = 80

export interface CreateLessonRunResult { lessonRunId: string; created: boolean }

const allocationFrom = (schoolOrgId: string, data: Record<string, unknown>): SchoolQuotaAllocation => ({
  schoolOrgId,
  guaranteedConcurrentLessonsAndMarkets: Number(data.guaranteedConcurrentLessonsAndMarkets ?? 0),
  guaranteedTeacherSeats: Number(data.guaranteedTeacherSeats ?? 0),
})

const reservationFrom = (reservationId: string, data: Record<string, unknown>): QuotaReservation | null => {
  const resourceKey = data.resourceKey
  if (resourceKey !== 'concurrentLessonsAndMarkets' && resourceKey !== 'teacherSeats') return null
  if (typeof data.schoolOrgId !== 'string' || typeof data.targetId !== 'string') return null
  return { reservationId, resourceKey, schoolOrgId: data.schoolOrgId, targetId: data.targetId }
}

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
  const lessonRunId = deps.generateLessonRunId()
  const randomSeed = deps.generateRandomSeed()

  return deps.firestore.runTransaction(async (tx) => {
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { lessonRunId: string; requestDigest: string }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ lessonRunId: prior.lessonRunId, created: false })
    }
    const templateSnap = await tx.get(`lessonTemplates/${deps.templateId}`)
    if (!templateSnap.exists) throw new Error('LessonTemplate not found')
    const template = templateSnap.data() as { orgId: string; currentPublishedVersionId: string | null; createdByUid: string; approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' }
    if (template.orgId !== deps.orgId) throw new Error('Template does not belong to this organization')
    if (!template.currentPublishedVersionId) throw new Error('Template has no published version to snapshot')
    if (template.createdByUid !== deps.primaryTeacherUid && (template.approvalStatus === 'PENDING' || template.approvalStatus === 'REJECTED')) {
      throw new Error('Template is not approved for use by other teachers')
    }
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
    const org = orgSnap.exists
      ? (orgSnap.data() as { type?: string; planId?: string; parentOrgId?: string })
      : undefined
    if (!org?.planId) throw new Error('この組織にはプランが設定されていません')
    const planSnap = await tx.get(`planDefinitions/${org.planId}`)
    if (!planSnap.exists) throw new Error('この組織にはプランが設定されていません')
    const plan = planSnap.data() as { limits: { concurrentLessonsAndMarkets: number } }
    const activeCount = await tx.countActiveLessonRuns(deps.orgId)
    const downgradeStatus = deps.getDowngradeStatus ? await deps.getDowngradeStatus(deps.orgId) : undefined
    if (downgradeStatus && !canIncreaseLimitedResource(downgradeStatus, 'concurrentLessonsAndMarkets')) {
      throw new Error('同時授業・市場数を整理する必要があります')
    }
    if ((!downgradeStatus || downgradeStatus.state === 'NORMAL' || downgradeStatus.state === 'SCHEDULED')
      && activeCount >= plan.limits.concurrentLessonsAndMarkets) {
      throw new Error('この組織の同時授業・市場数の上限に達しています')
    }

    let quotaReservation: QuotaReservation | null = null
    if (org.type === 'school' && typeof org.parentOrgId === 'string' && org.parentOrgId.length > 0) {
      const allocationPath = `organizations/${org.parentOrgId}/schoolAllocations/${deps.orgId}`
      const allocationSnap = await tx.get(allocationPath)
      if (!allocationSnap.exists) throw new Error('この学校の配分が見つかりません')
      const allocation = allocationFrom(deps.orgId, allocationSnap.data() ?? {})

      if (activeCount + 1 > allocation.guaranteedConcurrentLessonsAndMarkets) {
        const parentSnap = await tx.get(`organizations/${org.parentOrgId}`)
        const parentOrg = parentSnap.exists
          ? (parentSnap.data() as { type?: string; planId?: string; parentContractState?: unknown })
          : undefined
        if (parentOrg?.type !== 'parentOrg') throw new Error('上位組織が見つかりません')
        assertParentContractAllowsSharedQuota(parentContractStateFrom(parentOrg))
        if (!parentOrg.planId) throw new Error('上位組織のプランが設定されていません')

        const parentPlanSnap = await tx.get(`planDefinitions/${parentOrg.planId}`)
        if (!parentPlanSnap.exists) throw new Error('上位組織のプランが設定されていません')
        const parentPlan = parentPlanSnap.data() as {
          limits?: { concurrentLessonsAndMarkets?: unknown }
        }
        const parentLimit = parentPlan.limits?.concurrentLessonsAndMarkets
        if (typeof parentLimit !== 'number') throw new Error('上位組織の利用上限が見つかりません')

        const allocationDocuments = await tx.getCollection(`organizations/${org.parentOrgId}/schoolAllocations`)
        const reservationDocuments = await tx.getCollection(`organizations/${org.parentOrgId}/quotaReservations`)
        const allocations = allocationDocuments.map((document) => allocationFrom(document.id, document.data()))
        const reservations = reservationDocuments
          .map((document) => reservationFrom(document.id, document.data()))
          .filter((reservation): reservation is QuotaReservation => reservation !== null)

        quotaReservation = reserveSharedQuota({
          resourceKey: 'concurrentLessonsAndMarkets',
          parentLimit,
          allocations,
          reservations,
          schoolOrgId: deps.orgId,
          targetId: lessonRunId,
          currentUsage: activeCount + 1,
        })
      }
    }

    if (quotaReservation && org.parentOrgId) {
      tx.set(`organizations/${org.parentOrgId}/quotaReservations/${quotaReservation.reservationId}`, {
        ...quotaReservation,
        createdAt: nowValue,
      })
    }
    const snapshotContent = version.content as { subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; coreActivityMinutes?: number }
    const contentSubject = snapshotContent.subject
    const defaultPhaseGraph = buildDefaultPhases(contentSubject, snapshotContent.coreActivityMinutes)
    tx.set(`lessonRuns/${lessonRunId}`, {
      orgId: deps.orgId, templateId: deps.templateId, templateVersionId: template.currentPublishedVersionId,
      templateSnapshot: {
        ...(version.content as Record<string, unknown>),
        phases: defaultPhaseGraph.phases,
        initialPhaseId: defaultPhaseGraph.initialPhaseId,
      },
      subject: contentSubject,
      status: 'DRAFT', primaryTeacherUid: deps.primaryTeacherUid, teacherRoles: { [deps.primaryTeacherUid]: 'PRIMARY' },
      currentPhaseId: null, randomSeed, restoreGeneration: 0,
      startedAt: null, endedAt: null, createdAt: nowValue,
      maxParticipants: MAX_PARTICIPANTS, expectedParticipants: deps.expectedParticipants ?? null,
    })
    tx.set(idempotencyPath, { lessonRunId, requestDigest, createdAt: nowValue })
    return JSON.stringify({ lessonRunId, created: true })
  }).then((raw) => JSON.parse(raw) as CreateLessonRunResult)
}

/** Cryptographically random, generated once server-side. Never Math.random(). */
export const generateRandomSeed = (): string => randomBytes(16).toString('hex')

/** Production wiring: Firestore Admin SDK transaction + Node's crypto. */
export const createLessonRunWithAdminSdk = (input: {
  orgId: string; templateId: string; primaryTeacherUid: string; lessonRunIdempotencyKey: string; expectedParticipants: number
}): Promise<CreateLessonRunResult> => {
  const db = getFirestore()
  return createLessonRun({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        getCollection: async (path) => {
          const snap = await tx.get(db.collection(path))
          return snap.docs.map((document) => ({ id: document.id, data: () => document.data() }))
        },
        countActiveLessonRuns: async (orgId) => {
          const snap = await tx.get(
            db.collection('lessonRuns').where('orgId', '==', orgId).where('status', 'in', ACTIVE_LESSON_RUN_STATUSES),
          )
          return snap.size
        },
        set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) },
      })),
    },
    generateRandomSeed, generateLessonRunId: randomUUID, getDowngradeStatus: getDowngradeStatusWithAdminSdk, ...input,
  })
}
