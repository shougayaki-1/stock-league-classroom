import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { personalOrgId } from '../lib/personalOrgId'
import { isCallerTeacher } from '../organizations/onCall'
import { unconfiguredLlmProvider } from './llmProvider'
import { assertNoForbiddenFields } from './piiFilter'
import { buildLessonDraftPrompt, parseLessonDraftResponse, type LessonDraftPromptInput } from './lessonDraftPrompt'
import { buildTeacherGuidancePrompt, parseTeacherGuidanceResponse, type TeacherGuidancePromptInput } from './teacherGuidancePrompt'

interface GenerateLessonDraftRequest { theme?: unknown; mainObjective?: unknown; subject?: unknown; difficulty?: unknown; materialTexts?: unknown }
const isValidRequest = (data: GenerateLessonDraftRequest): data is LessonDraftPromptInput => typeof data.theme === 'string' && typeof data.mainObjective === 'string' && (data.subject === 'SOCIAL_STUDIES' || data.subject === 'HOME_ECONOMICS') && (data.difficulty === 'BASIC' || data.difficulty === 'STANDARD' || data.difficulty === 'ADVANCED') && (data.materialTexts === undefined || (Array.isArray(data.materialTexts) && data.materialTexts.every((item) => typeof item === 'string')))

/** Returns an unpersisted draft suggestion; the existing overview confirmation is the only template write path. */
export const generateLessonDraftCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const teacherUid = request.auth.uid
  const data = request.data as GenerateLessonDraftRequest
  if (!isValidRequest(data)) throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const db = getFirestore()
  const orgId = personalOrgId(teacherUid)
  const org = await db.doc(`organizations/${orgId}`).get()
  if (!org.exists || org.get('aiEnabled') !== true) throw new HttpsError('failed-precondition', 'AI機能はこの組織では有効化されていません。')
  if (data.materialTexts?.length && org.get('materialsUploadEnabled') !== true) throw new HttpsError('failed-precondition', '資料アップロード機能はこの組織では有効化されていません。')
  const logUsage = (succeeded: boolean) => db.collection(`organizations/${orgId}/aiUsageLog`).add({ orgId, teacherUid, feature: 'LESSON_DRAFT', succeeded, createdAt: new Date() })
  try {
    assertNoForbiddenFields(data as unknown as Record<string, unknown>)
    const draft = parseLessonDraftResponse(await unconfiguredLlmProvider.generateText(buildLessonDraftPrompt(data)))
    await logUsage(true)
    return draft
  } catch {
    await logUsage(false)
    throw new HttpsError('unavailable', 'AI提案の生成に失敗しました。固定の案をご利用ください。')
  }
})

export const generateTeacherGuidanceCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as { topic?: unknown }
  if (typeof data.topic !== 'string' || !data.topic) throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const teacherUid = request.auth.uid; const orgId = personalOrgId(teacherUid); const db = getFirestore(); const org = await db.doc(`organizations/${orgId}`).get()
  if (!org.exists || org.get('aiEnabled') !== true) throw new HttpsError('failed-precondition', 'AI機能はこの組織では有効化されていません。')
  const logUsage = (succeeded: boolean) => db.collection(`organizations/${orgId}/aiUsageLog`).add({ orgId, teacherUid, feature: 'TEACHER_GUIDANCE', succeeded, createdAt: new Date() })
  try { assertNoForbiddenFields(data as Record<string, unknown>); const result = parseTeacherGuidanceResponse(await unconfiguredLlmProvider.generateText(buildTeacherGuidancePrompt(data as TeacherGuidancePromptInput))); await logUsage(true); return result } catch { await logUsage(false); throw new HttpsError('unavailable', 'AI下書きの生成に失敗しました。手動で入力してください。') }
})
