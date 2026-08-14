import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { personalOrgId } from '../lib/personalOrgId'
import { isCallerTeacher } from '../organizations/onCall'
import { unconfiguredLlmProvider } from './llmProvider'
import { assertNoForbiddenFields } from './piiFilter'
import { buildLessonDraftPrompt, parseLessonDraftResponse, type LessonDraftPromptInput } from './lessonDraftPrompt'
import { buildTeacherGuidancePrompt, parseTeacherGuidanceResponse, type TeacherGuidancePromptInput } from './teacherGuidancePrompt'
import { AiKillSwitchEnabledError, AiQuotaExceededError, checkAiQuota, consumeAiQuota, getAiUsageQuotaDepsWithAdminSdk } from './usageQuota'

interface GenerateLessonDraftRequest { theme?: unknown; mainObjective?: unknown; subject?: unknown; difficulty?: unknown; materialTexts?: unknown }
const isValidRequest = (data: GenerateLessonDraftRequest): data is LessonDraftPromptInput => typeof data.theme === 'string' && typeof data.mainObjective === 'string' && (data.subject === 'SOCIAL_STUDIES' || data.subject === 'HOME_ECONOMICS') && (data.difficulty === 'BASIC' || data.difficulty === 'STANDARD' || data.difficulty === 'ADVANCED') && (data.materialTexts === undefined || (Array.isArray(data.materialTexts) && data.materialTexts.every((item) => typeof item === 'string')))

/**
 * キルスイッチ・利用枠超過エラーを HttpsError に変換して返す。
 * それ以外の未知のエラーは変換できないため、呼び出し元に向けてそのまま再 throw する
 * (関数名・戻り値型が示す「HttpsError を返す」は既知エラーの場合のみ)。
 */
const toQuotaHttpsErrorOrRethrow = (error: unknown): HttpsError => {
  if (error instanceof AiKillSwitchEnabledError) return new HttpsError('unavailable', error.message)
  if (error instanceof AiQuotaExceededError) return new HttpsError('resource-exhausted', error.message)
  throw error
}

/**
 * 枠消費(consumeAiQuota)と成功ログ書き込みをまとめて実行する。
 * これらはあくまで付随的な記帳処理であり、失敗しても既に生成済みの結果を
 * クライアントへ返す判断には影響させない(呼び出し元は catch しない)。
 * 失敗時はエラーログに記録するのみとする。
 */
const recordSuccessAndConsumeQuota = async (params: { quotaDeps: ReturnType<typeof getAiUsageQuotaDepsWithAdminSdk>; orgId: string; logUsage: (succeeded: boolean) => Promise<unknown> }): Promise<void> => {
  try {
    await Promise.all([params.logUsage(true), consumeAiQuota(params.quotaDeps, { orgId: params.orgId })])
  } catch (error) {
    console.error('AI usage quota bookkeeping failed after a successful generation', error)
  }
}

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
  const quotaDeps = getAiUsageQuotaDepsWithAdminSdk()
  try { await checkAiQuota(quotaDeps, { orgId }) } catch (error) { throw toQuotaHttpsErrorOrRethrow(error) }
  const logUsage = (succeeded: boolean) => db.collection(`organizations/${orgId}/aiUsageLog`).add({ orgId, teacherUid, feature: 'LESSON_DRAFT', succeeded, createdAt: new Date() })
  let draft
  try {
    assertNoForbiddenFields(data as unknown as Record<string, unknown>)
    draft = parseLessonDraftResponse(await unconfiguredLlmProvider.generateText(buildLessonDraftPrompt(data)))
  } catch {
    await logUsage(false)
    throw new HttpsError('unavailable', 'AI提案の生成に失敗しました。固定の案をご利用ください。')
  }
  await recordSuccessAndConsumeQuota({ quotaDeps, orgId, logUsage })
  return draft
})

export const generateTeacherGuidanceCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as { topic?: unknown }
  if (typeof data.topic !== 'string' || !data.topic) throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const teacherUid = request.auth.uid; const orgId = personalOrgId(teacherUid); const db = getFirestore(); const org = await db.doc(`organizations/${orgId}`).get()
  if (!org.exists || org.get('aiEnabled') !== true) throw new HttpsError('failed-precondition', 'AI機能はこの組織では有効化されていません。')
  const quotaDeps = getAiUsageQuotaDepsWithAdminSdk()
  try { await checkAiQuota(quotaDeps, { orgId }) } catch (error) { throw toQuotaHttpsErrorOrRethrow(error) }
  const logUsage = (succeeded: boolean) => db.collection(`organizations/${orgId}/aiUsageLog`).add({ orgId, teacherUid, feature: 'TEACHER_GUIDANCE', succeeded, createdAt: new Date() })
  let result
  try {
    assertNoForbiddenFields(data as Record<string, unknown>)
    result = parseTeacherGuidanceResponse(await unconfiguredLlmProvider.generateText(buildTeacherGuidancePrompt(data as TeacherGuidancePromptInput)))
  } catch {
    await logUsage(false)
    throw new HttpsError('unavailable', 'AI下書きの生成に失敗しました。手動で入力してください。')
  }
  await recordSuccessAndConsumeQuota({ quotaDeps, orgId, logUsage })
  return result
})
