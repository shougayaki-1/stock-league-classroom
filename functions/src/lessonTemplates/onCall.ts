import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { publishLessonVersionWithAdminSdk, type PublishLessonVersionResult } from './publishLessonVersion'

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

  return publishLessonVersionWithAdminSdk({
    templateId: request.data.templateId,
    orgId,
    uid: request.auth.uid,
    changeSummary: request.data.changeSummary,
    idempotencyKey: request.data.idempotencyKey,
  })
})
