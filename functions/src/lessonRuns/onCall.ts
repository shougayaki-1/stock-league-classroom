import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createLessonRunWithAdminSdk } from './createLessonRun'

interface CreateLessonRunRequest { templateId: string; lessonRunIdempotencyKey: string }

export const createLessonRunCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateLessonRunRequest
  if (!data.templateId || !data.lessonRunIdempotencyKey) throw new HttpsError('invalid-argument', 'templateId と lessonRunIdempotencyKey は必須です。')
  const templateSnap = await getFirestore().doc(`lessonTemplates/${data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', '教材が見つかりません。')
  const orgId = templateSnap.get('orgId') as string
  await requireActiveOrgMember(getFirestore(), orgId, request.auth.uid)
  return createLessonRunWithAdminSdk({
    orgId, templateId: data.templateId,
    primaryTeacherUid: request.auth.uid, lessonRunIdempotencyKey: data.lessonRunIdempotencyKey,
  })
})
