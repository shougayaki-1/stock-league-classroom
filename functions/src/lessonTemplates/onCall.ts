import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
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
  const sourceOrgId = templateSnap.get('orgId') as string
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

  const templateSnap = await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('createdByUid') !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ公開できます。')
  if (!templateSnap.get('currentPublishedVersionId')) throw new HttpsError('failed-precondition', '公開済みの版がまだありません。')

  await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).update({ visibility: 'COMMUNITY' })
  return { published: true }
})

export const unpublishTemplateFromCommunityCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isValidTemplateIdInput(request.data)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const templateSnap = await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('createdByUid') !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ非公開にできます。')

  await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).update({ visibility: 'PRIVATE' })
  return { published: false }
})

