import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createLessonRunWithAdminSdk } from './createLessonRun'
import { restoreCheckpointWithAdminSdk } from './checkpoint'

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

interface RestoreCheckpointRequest { lessonRunId: string; checkpointId: string; reason: string; idempotencyKey: string }

/**
 * Authorization for restore is stricter than for read: teacher() Firestore
 * rules allow any teacher on the org to *read* a run, but only a
 * PRIMARY/ASSISTANT teacher on THIS run may restore it — a VIEWER must be
 * rejected even though they can see the run. orgId is always read from the
 * run document itself, never taken from client input, so a caller cannot
 * point requireActiveOrgMember at an org they belong to while acting on a
 * run that belongs to a different org.
 */
export const restoreCheckpointCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as RestoreCheckpointRequest
  if (!data.lessonRunId || !data.checkpointId || !data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、checkpointId、reason、idempotencyKey は必須です。')
  }
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (role !== 'PRIMARY' && role !== 'ASSISTANT') {
    throw new HttpsError('permission-denied', 'PRIMARYまたはASSISTANTの教師のみ復元できます。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)
  return restoreCheckpointWithAdminSdk({
    lessonRunId: data.lessonRunId, checkpointId: data.checkpointId,
    reason: data.reason, actorId: request.auth.uid, idempotencyKey: data.idempotencyKey,
  })
})
