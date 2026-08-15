import { getFirestore } from 'firebase-admin/firestore'

export interface TemplateReviewDeps {
  getCompletedRunTemplateVersionIds: (templateId: string, uid: string) => Promise<string[]>
  getOwnDuplicateTemplateIds: (sourceTemplateId: string, sourceVersionId: string, uid: string) => Promise<string[]>
  getReview: (versionId: string, uid: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  setReview: (versionId: string, uid: string, data: Record<string, unknown>) => Promise<void>
  listReviewsForVersion: (versionId: string) => Promise<Array<Record<string, unknown>>>
  updateTemplateAggregate: (templateId: string, aggregate: Record<string, unknown>) => Promise<void>
  now?: () => unknown
}

export interface EligibilityCheckInput { templateId: string; versionId: string; uid: string }

/**
 * A teacher outside the source template's org can only run it after
 * duplicating it into their own org (createLessonRunCallable has no
 * COMMUNITY/share-token bypass, unlike duplicateLessonTemplateCallable) — so
 * their completed lessonRun carries the DUPLICATE's templateId, not the
 * original's. Eligibility therefore checks direct completion first, then
 * falls back to any of the caller's own duplicates of this exact version.
 */
export const isEligibleToReviewTemplate = async (
  deps: Pick<TemplateReviewDeps, 'getCompletedRunTemplateVersionIds' | 'getOwnDuplicateTemplateIds'>,
  input: EligibilityCheckInput,
): Promise<boolean> => {
  const directVersionIds = await deps.getCompletedRunTemplateVersionIds(input.templateId, input.uid)
  if (directVersionIds.includes(input.versionId)) return true

  const duplicateTemplateIds = await deps.getOwnDuplicateTemplateIds(input.templateId, input.versionId, input.uid)
  for (const duplicateTemplateId of duplicateTemplateIds) {
    const duplicateVersionIds = await deps.getCompletedRunTemplateVersionIds(duplicateTemplateId, input.uid)
    if (duplicateVersionIds.length > 0) return true
  }
  return false
}

export interface SubmitTemplateReviewInput {
  templateId: string; versionId: string; uid: string
  clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number
  comment: string | null
}

const average = (reviews: Array<Record<string, unknown>>, key: string): number =>
  reviews.reduce((sum, review) => sum + (review[key] as number), 0) / reviews.length

export const submitTemplateReview = async (deps: TemplateReviewDeps, input: SubmitTemplateReviewInput): Promise<void> => {
  const eligible = await isEligibleToReviewTemplate(deps, { templateId: input.templateId, versionId: input.versionId, uid: input.uid })
  if (!eligible) throw new Error('Not eligible to review this template version')

  const now = deps.now ? deps.now() : new Date().toISOString()
  const existing = await deps.getReview(input.versionId, input.uid)
  await deps.setReview(input.versionId, input.uid, {
    templateId: input.templateId, versionId: input.versionId, reviewedByUid: input.uid,
    clarityRating: input.clarityRating, easeOfImplementationRating: input.easeOfImplementationRating, studentResponseRating: input.studentResponseRating,
    comment: input.comment,
    createdAt: existing.exists ? existing.data?.createdAt : now, updatedAt: now,
  })

  const reviews = await deps.listReviewsForVersion(input.versionId)
  await deps.updateTemplateAggregate(input.templateId, {
    reviewCount: reviews.length,
    averageClarityRating: average(reviews, 'clarityRating'),
    averageEaseOfImplementationRating: average(reviews, 'easeOfImplementationRating'),
    averageStudentResponseRating: average(reviews, 'studentResponseRating'),
  })
}

export const listTemplateReviews = (
  deps: Pick<TemplateReviewDeps, 'listReviewsForVersion'>,
  versionId: string,
): Promise<Array<Record<string, unknown>>> => deps.listReviewsForVersion(versionId)

const reviewDocId = (versionId: string, uid: string): string => `${versionId}_${uid}`

/** Production wiring: Firestore Admin SDK. */
export const getTemplateReviewDepsWithAdminSdk = (nowFn: () => unknown = () => new Date().toISOString()): TemplateReviewDeps => {
  const db = getFirestore()
  return {
    getCompletedRunTemplateVersionIds: async (templateId, uid) => {
      const snap = await db.collection('lessonRuns')
        .where('templateId', '==', templateId).where('primaryTeacherUid', '==', uid).where('status', '==', 'COMPLETED')
        .get()
      return snap.docs.map((document) => (document.data() as { templateVersionId: string }).templateVersionId)
    },
    getOwnDuplicateTemplateIds: async (sourceTemplateId, sourceVersionId, uid) => {
      const snap = await db.collection('lessonTemplates')
        .where('sourceTemplateId', '==', sourceTemplateId).where('sourceVersionId', '==', sourceVersionId).where('createdByUid', '==', uid)
        .get()
      return snap.docs.map((document) => document.id)
    },
    getReview: async (versionId, uid) => {
      const snap = await db.doc(`templateReviews/${reviewDocId(versionId, uid)}`).get()
      return { exists: snap.exists, data: snap.exists ? (snap.data() as Record<string, unknown>) : undefined }
    },
    setReview: async (versionId, uid, data) => { await db.doc(`templateReviews/${reviewDocId(versionId, uid)}`).set(data) },
    listReviewsForVersion: async (versionId) => {
      const snap = await db.collection('templateReviews').where('versionId', '==', versionId).get()
      return snap.docs.map((document) => document.data() as Record<string, unknown>)
    },
    updateTemplateAggregate: async (templateId, aggregate) => { await db.doc(`lessonTemplates/${templateId}`).update(aggregate) },
    now: nowFn,
  }
}
