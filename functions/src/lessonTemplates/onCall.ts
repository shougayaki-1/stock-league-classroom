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
  // Mirrors firestore.rules' `allow get`/`allow list` gate on lessonTemplates
  // (activeMember(resource.data.orgId)): this Callable runs on the Admin SDK
  // and bypasses Rules, so it must re-enforce the same "must belong to the
  // source template's org to read it" boundary itself, or duplication would
  // become a way to exfiltrate another org's lesson content.
  await requireActiveOrgMember(firestore, sourceOrgId, request.auth.uid)
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
