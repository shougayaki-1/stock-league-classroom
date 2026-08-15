import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { publishLessonVersionWithAdminSdk, type PublishLessonVersionResult } from './publishLessonVersion'
import {
  duplicateLessonTemplateWithAdminSdk,
  type DuplicateLessonTemplateResult,
  type ScheduleSensitiveSettings,
} from './duplicateLessonTemplate'
import {
  createTemplateShareWithAdminSdk,
  resolveTemplateShareWithAdminSdk,
  revokeTemplateSharesWithAdminSdk,
} from './templateShares'
import {
  getTemplateReviewDepsWithAdminSdk,
  isEligibleToReviewTemplate,
  listTemplateReviews,
  submitTemplateReview,
} from './templateReviews'

export interface PublishLessonVersionCallableInput {
  templateId: string
  changeSummary?: string
  idempotencyKey: string
}

/** The only shape a client may send: orgId is never accepted from the caller. */
export const isValidPublishLessonVersionInput = (data: unknown): data is PublishLessonVersionCallableInput => {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  if (typeof record.templateId !== 'string' || record.templateId.length === 0) return false
  if (typeof record.idempotencyKey !== 'string' || record.idempotencyKey.length === 0) return false
  if (record.changeSummary !== undefined && typeof record.changeSummary !== 'string') return false
  return true
}

export const publishLessonVersionCallable = onCall({ region: 'asia-northeast1' }, async (request): Promise<PublishLessonVersionResult> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isValidPublishLessonVersionInput(request.data)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const firestore = getFirestore()
  const templateSnap = await firestore.doc(`lessonTemplates/${request.data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('moveOperationId')) throw new HttpsError('failed-precondition', '教材の移動中は公開できません。')
  // orgId always comes from the stored template, never from client input.
  const orgId = templateSnap.get('orgId') as string
  await requireActiveOrgMember(firestore, orgId, request.auth.uid)

  try {
    return await publishLessonVersionWithAdminSdk({
      templateId: request.data.templateId,
      orgId,
      uid: request.auth.uid,
      changeSummary: request.data.changeSummary,
      idempotencyKey: request.data.idempotencyKey,
    })
  } catch (error) {
    throw translatePublishLessonVersionError(error)
  }
})

/**
 * Translates publishLessonVersion's bare Error messages into the same
 * HttpsError codes previously thrown inline from the pure layer — moving
 * WHERE the translation happens (to the Callable boundary, matching every
 * other task's pure-layer convention) without changing what the client
 * observes. Errors this function doesn't recognize pass through unchanged so
 * onCall's default `internal` handling still applies to genuinely
 * unexpected failures.
 */
const translatePublishLessonVersionError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Lesson template not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Lesson template does not belong to the expected organization') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

export interface DuplicateLessonTemplateCallableInput {
  sourceTemplateId: string
  sourceVersionId: string
  targetOrgId: string
  confirmedOverrides: Partial<ScheduleSensitiveSettings>
  idempotencyKey: string
  shareToken?: string
}

/** The only shape a client may send: uid/sourceOrgId are never accepted from the caller. */
export const isValidDuplicateLessonTemplateInput = (data: unknown): data is DuplicateLessonTemplateCallableInput => {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  if (typeof record.sourceTemplateId !== 'string' || record.sourceTemplateId.length === 0) return false
  if (typeof record.sourceVersionId !== 'string' || record.sourceVersionId.length === 0) return false
  if (typeof record.targetOrgId !== 'string' || record.targetOrgId.length === 0) return false
  if (typeof record.confirmedOverrides !== 'object' || record.confirmedOverrides === null || Array.isArray(record.confirmedOverrides)) return false
  if (typeof record.idempotencyKey !== 'string' || record.idempotencyKey.length === 0) return false
  if (record.shareToken !== undefined && (typeof record.shareToken !== 'string' || record.shareToken.length === 0)) return false
  return true
}

export const duplicateLessonTemplateCallable = onCall({ region: 'asia-northeast1' }, async (request): Promise<DuplicateLessonTemplateResult> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isValidDuplicateLessonTemplateInput(request.data)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const firestore = getFirestore()
  const sourceTemplateSnap = await firestore.doc(`lessonTemplates/${request.data.sourceTemplateId}`).get()
  if (!sourceTemplateSnap.exists) throw new HttpsError('not-found', '複製元のレッスンテンプレートが見つかりません。')
  if (sourceTemplateSnap.get('moveOperationId')) throw new HttpsError('failed-precondition', '教材の移動中は複製できません。')
  // sourceOrgId always comes from the stored source template, never from client input.
  const sourceOrgId = sourceTemplateSnap.get('orgId') as string
  if (request.data.shareToken) {
    let share
    try {
      share = await resolveTemplateShareWithAdminSdk({ token: request.data.shareToken })
    } catch {
      throw new HttpsError('not-found', '共有リンクが無効です。')
    }
    if (share.templateId !== request.data.sourceTemplateId || share.versionId !== request.data.sourceVersionId) {
      throw new HttpsError('permission-denied', '共有リンクの対象と一致しません。')
    }
    // A valid, matching share token substitutes for source-org membership —
    // this is the one intentional way to read/duplicate another org's
    // template, mirroring the comment below for target-org membership.
  } else if (sourceTemplateSnap.get('visibility') === 'COMMUNITY') {
    // A COMMUNITY-visible template is readable by any teacher (mirrors the
    // Firestore rule relaxation), so source-org membership is not required
    // either — the same intentional bypass as the shareToken branch above.
  } else {
    // Mirrors firestore.rules' `allow get`/`allow list` gate on lessonTemplates
    // (activeMember(resource.data.orgId)): this Callable runs on the Admin SDK
    // and bypasses Rules, so it must re-enforce the same "must belong to the
    // source template's org to read it" boundary itself, or duplication would
    // become a way to exfiltrate another org's lesson content.
    await requireActiveOrgMember(firestore, sourceOrgId, request.auth.uid)
  }
  // targetOrgId is client-chosen (picking where the copy lands is a
  // legitimate use case), but the caller must actually have material
  // creation rights there.
  await requireActiveOrgMember(firestore, request.data.targetOrgId, request.auth.uid)

  try {
    return await duplicateLessonTemplateWithAdminSdk({
      sourceTemplateId: request.data.sourceTemplateId,
      sourceVersionId: request.data.sourceVersionId,
      targetOrgId: request.data.targetOrgId,
      uid: request.auth.uid,
      confirmedOverrides: request.data.confirmedOverrides,
      idempotencyKey: request.data.idempotencyKey,
    })
  } catch (error) {
    throw translateDuplicateLessonTemplateError(error)
  }
})

/** Same translation strategy as translatePublishLessonVersionError — see its doc comment. */
const translateDuplicateLessonTemplateError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Source lesson version not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Source lesson version does not belong to the expected template') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

interface CreateTemplateShareCallableInput { templateId?: unknown; versionId?: unknown; expiresInDays?: unknown }
const isValidExpiresInDays = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 90

export const createTemplateShareCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateTemplateShareCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string' || !isValidExpiresInDays(data.expiresInDays)) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }
  const firestore = getFirestore()
  const templateSnap = await firestore.doc(`lessonTemplates/${data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('moveOperationId')) throw new HttpsError('failed-precondition', '教材の移動中は共有リンクを発行できません。')
  const sourceOrgId = templateSnap.get('orgId') as string
  await requireActiveOrgMember(firestore, sourceOrgId, request.auth.uid)
  const createdByUid = templateSnap.get('createdByUid') as string
  if (createdByUid !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ共有リンクを発行できます。')

  return createTemplateShareWithAdminSdk({
    templateId: data.templateId, versionId: data.versionId, sourceOrgId, createdByUid, expiresInDays: data.expiresInDays,
  })
})

interface ResolveTemplateShareCallableInput { token?: unknown }

export const resolveTemplateShareCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ResolveTemplateShareCallableInput
  if (typeof data.token !== 'string' || data.token.length === 0) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  let share
  try {
    share = await resolveTemplateShareWithAdminSdk({ token: data.token })
  } catch {
    throw new HttpsError('not-found', '共有リンクが無効です。')
  }
  const versionSnap = await getFirestore().doc(`lessonTemplates/${share.templateId}/versions/${share.versionId}`).get()
  return { templateId: share.templateId, versionId: share.versionId, content: versionSnap.get('content') }
})

interface RevokeTemplateShareCallableInput { templateId?: unknown; versionId?: unknown }

export const revokeTemplateShareCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as RevokeTemplateShareCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const firestore = getFirestore()
  const templateSnap = await firestore.doc(`lessonTemplates/${data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('moveOperationId')) throw new HttpsError('failed-precondition', '教材の移動中は共有リンクを無効化できません。')
  const sourceOrgId = templateSnap.get('orgId') as string
  await requireActiveOrgMember(firestore, sourceOrgId, request.auth.uid)

  await revokeTemplateSharesWithAdminSdk({ templateId: data.templateId, versionId: data.versionId, createdByUid: request.auth.uid })
  return { revoked: true }
})

interface CommunityVisibilityCallableInput { templateId?: unknown }
const isValidTemplateIdInput = (data: unknown): data is { templateId: string } =>
  typeof data === 'object' && data !== null && typeof (data as CommunityVisibilityCallableInput).templateId === 'string'

export const publishTemplateToCommunityCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isValidTemplateIdInput(request.data)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const firestore = getFirestore()
  const templateSnap = await firestore.doc(`lessonTemplates/${request.data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('moveOperationId')) throw new HttpsError('failed-precondition', '教材の移動中はコミュニティ公開できません。')
  const orgId = templateSnap.get('orgId') as string
  await requireActiveOrgMember(firestore, orgId, request.auth.uid)
  if (templateSnap.get('createdByUid') !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ公開できます。')
  if (!templateSnap.get('currentPublishedVersionId')) throw new HttpsError('failed-precondition', '公開済みの版がまだありません。')

  await firestore.doc(`lessonTemplates/${request.data.templateId}`).update({ visibility: 'COMMUNITY', publishedToCommunityAt: FieldValue.serverTimestamp() })
  return { published: true }
})

export const unpublishTemplateFromCommunityCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isValidTemplateIdInput(request.data)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const firestore = getFirestore()
  const templateSnap = await firestore.doc(`lessonTemplates/${request.data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('moveOperationId')) throw new HttpsError('failed-precondition', '教材の移動中はコミュニティ公開を変更できません。')
  const orgId = templateSnap.get('orgId') as string
  await requireActiveOrgMember(firestore, orgId, request.auth.uid)
  if (templateSnap.get('createdByUid') !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ非公開にできます。')

  await firestore.doc(`lessonTemplates/${request.data.templateId}`).update({ visibility: 'PRIVATE' })
  return { published: false }
})

const TEMPLATE_REPORT_REASONS = ['PERSONAL_INFO', 'COPYRIGHT', 'INAPPROPRIATE', 'MISINFORMATION', 'OTHER'] as const
type TemplateReportReason = typeof TEMPLATE_REPORT_REASONS[number]

interface ReportTemplateCallableInput { templateId?: unknown; versionId?: unknown; reason?: unknown; details?: unknown }
const isValidReportReason = (value: unknown): value is TemplateReportReason => TEMPLATE_REPORT_REASONS.includes(value as TemplateReportReason)

export const reportTemplateCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ReportTemplateCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string' || !isValidReportReason(data.reason)) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }
  if (data.details !== undefined && typeof data.details !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const templateSnap = await getFirestore().doc(`lessonTemplates/${data.templateId}`).get()
  if (!templateSnap.exists || templateSnap.get('visibility') !== 'COMMUNITY') throw new HttpsError('not-found', '通報対象の教材が見つかりません。')
  if (templateSnap.get('createdByUid') === request.auth.uid) throw new HttpsError('permission-denied', '自分が作成した教材は通報できません。')

  const added = await getFirestore().collection('templateReports').add({
    templateId: data.templateId, versionId: data.versionId, reportedByUid: request.auth.uid,
    reason: data.reason, details: data.details ?? null,
    status: 'PENDING', resolution: null, resolvedByUid: null, resolvedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  })
  return { reportId: added.id }
})

/** Mirrors firestore.rules' operator(): teacher() && request.auth.token.operator == true. */
const isCallerOperator = (token: { email_verified?: boolean; firebase?: { sign_in_provider?: string }; operator?: boolean }): boolean =>
  isCallerTeacher(token) && token.operator === true

export const listPendingTemplateReportsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerOperator(request.auth.token)) throw new HttpsError('permission-denied', '運営者アカウントのみ利用できます。')

  const snapshot = await getFirestore().collection('templateReports').where('status', '==', 'PENDING').get()
  const reports = await Promise.all(snapshot.docs.map(async (reportDoc) => {
    const data = reportDoc.data() as { templateId: string; versionId: string; reportedByUid: string; reason: TemplateReportReason; details: string | null; createdAt: unknown }
    const templateSnap = await getFirestore().doc(`lessonTemplates/${data.templateId}`).get()
    return {
      id: reportDoc.id, templateId: data.templateId, versionId: data.versionId, reportedByUid: data.reportedByUid,
      reason: data.reason, details: data.details, createdAt: data.createdAt,
      templateTitle: templateSnap.exists ? (templateSnap.get('title') as string | undefined) ?? null : null,
    }
  }))
  return reports
})

interface ResolveTemplateReportCallableInput { reportId?: unknown; action?: unknown }
const isValidResolveAction = (value: unknown): value is 'UNPUBLISH' | 'DISMISS' => value === 'UNPUBLISH' || value === 'DISMISS'

export const resolveTemplateReportCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerOperator(request.auth.token)) throw new HttpsError('permission-denied', '運営者アカウントのみ利用できます。')
  const data = request.data as ResolveTemplateReportCallableInput
  if (typeof data.reportId !== 'string' || !isValidResolveAction(data.action)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const reportSnap = await getFirestore().doc(`templateReports/${data.reportId}`).get()
  if (!reportSnap.exists || reportSnap.get('status') !== 'PENDING') throw new HttpsError('not-found', '通報が見つからないか、既に解決済みです。')

  if (data.action === 'UNPUBLISH') {
    const templateId = reportSnap.get('templateId') as string
    await getFirestore().doc(`lessonTemplates/${templateId}`).update({ visibility: 'PRIVATE' })
  }
  await getFirestore().doc(`templateReports/${data.reportId}`).update({
    status: 'RESOLVED', resolution: data.action === 'UNPUBLISH' ? 'UNPUBLISHED' : 'DISMISSED',
    resolvedByUid: request.auth.uid, resolvedAt: FieldValue.serverTimestamp(),
  })
  return { resolved: true }
})

interface GrantOperatorCallableInput { targetUid?: unknown }

export const grantOperatorCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerOperator(request.auth.token)) throw new HttpsError('permission-denied', '運営者アカウントのみ利用できます。')
  const data = request.data as GrantOperatorCallableInput
  if (typeof data.targetUid !== 'string' || data.targetUid.length === 0) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  await getAuth().setCustomUserClaims(data.targetUid, { operator: true })
  return { granted: true }
})

interface CanReviewTemplateCallableInput { templateId?: unknown; versionId?: unknown }

export const canReviewTemplateCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CanReviewTemplateCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const eligible = await isEligibleToReviewTemplate(getTemplateReviewDepsWithAdminSdk(), { templateId: data.templateId, versionId: data.versionId, uid: request.auth.uid })
  return { eligible }
})

interface SubmitTemplateReviewCallableInput {
  templateId?: unknown; versionId?: unknown
  clarityRating?: unknown; easeOfImplementationRating?: unknown; studentResponseRating?: unknown
  comment?: unknown
}
const isValidRating = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5

export const submitTemplateReviewCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as SubmitTemplateReviewCallableInput
  if (
    typeof data.templateId !== 'string' || typeof data.versionId !== 'string'
    || !isValidRating(data.clarityRating) || !isValidRating(data.easeOfImplementationRating) || !isValidRating(data.studentResponseRating)
    || (data.comment !== undefined && typeof data.comment !== 'string')
  ) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }

  try {
    await submitTemplateReview(getTemplateReviewDepsWithAdminSdk(), {
      templateId: data.templateId, versionId: data.versionId, uid: request.auth.uid,
      clarityRating: data.clarityRating, easeOfImplementationRating: data.easeOfImplementationRating, studentResponseRating: data.studentResponseRating,
      comment: (data.comment as string | undefined) ?? null,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not eligible to review this template version') {
      throw new HttpsError('permission-denied', 'この教材を実際に授業で使用した教師のみレビューできます。')
    }
    throw error
  }
  return { submitted: true }
})

interface ListTemplateReviewsCallableInput { templateId?: unknown; versionId?: unknown }

export const listTemplateReviewsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListTemplateReviewsCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  return listTemplateReviews(getTemplateReviewDepsWithAdminSdk(), data.versionId)
})

const requireManager = (membership: { role: string }, message: string) => {
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new HttpsError('permission-denied', message)
}

interface ListPendingTemplateApprovalsRequest { orgId?: unknown }

export const listPendingTemplateApprovalsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListPendingTemplateApprovalsRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  requireManager(await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid), 'owner または admin のみ承認待ち一覧を確認できます。')

  const snapshot = await getFirestore().collection('lessonTemplates').where('orgId', '==', data.orgId).where('approvalStatus', '==', 'PENDING').get()
  return snapshot.docs.map((doc) => {
    const templateData = doc.data() as { title: string; createdByUid: string; updatedAt: unknown }
    return { id: doc.id, title: templateData.title, createdByUid: templateData.createdByUid, updatedAt: templateData.updatedAt }
  })
})

interface ReviewTemplateApprovalRequest { orgId?: unknown; templateId?: unknown; decision?: unknown }
const isValidApprovalDecision = (value: unknown): value is 'APPROVED' | 'REJECTED' => value === 'APPROVED' || value === 'REJECTED'

export const reviewTemplateApprovalCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ReviewTemplateApprovalRequest
  if (typeof data.orgId !== 'string' || typeof data.templateId !== 'string' || !isValidApprovalDecision(data.decision)) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }
  requireManager(await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid), 'owner または admin のみ承認・却下できます。')

  const templateRef = getFirestore().doc(`lessonTemplates/${data.templateId}`)
  const templateSnap = await templateRef.get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('moveOperationId')) throw new HttpsError('failed-precondition', '教材の移動中は承認状態を変更できません。')
  if (templateSnap.get('orgId') !== data.orgId) throw new HttpsError('failed-precondition', 'このテンプレートは対象組織のものではありません。')
  if (templateSnap.get('approvalStatus') !== 'PENDING') throw new HttpsError('failed-precondition', 'このテンプレートは承認待ちではありません。')

  await templateRef.update({ approvalStatus: data.decision, reviewedByUid: request.auth.uid, reviewedAt: FieldValue.serverTimestamp() })
  return { approvalStatus: data.decision }
})






