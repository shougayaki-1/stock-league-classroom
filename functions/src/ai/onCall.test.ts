import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { generateLessonDraftCallable, generateTeacherGuidanceCallable } from './onCall'
import { AiKillSwitchEnabledError, AiQuotaExceededError, checkAiQuota, consumeAiQuota } from './usageQuota'

const orgGet = vi.fn()
const usageLogAdd = vi.fn()
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: orgGet }), collection: () => ({ add: usageLogAdd }) }) }))
vi.mock('./usageQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./usageQuota')>()
  return { ...actual, checkAiQuota: vi.fn(), consumeAiQuota: vi.fn(), getAiUsageQuotaDepsWithAdminSdk: () => ({}) }
})
const generateText = vi.fn()
vi.mock('./llmProvider', () => ({ unconfiguredLlmProvider: { generateText: (...args: unknown[]) => generateText(...args) } }))

const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']
const request = (auth = teacher, data: Record<string, unknown> = {}): CallableRequest => ({ auth, data: { theme: 'テーマ', mainObjective: '目標', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD', ...data }, rawRequest: {} } as unknown as CallableRequest)
const guidanceRequest = (auth = teacher, data: Record<string, unknown> = { topic: 'トピック' }): CallableRequest => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

describe('generateLessonDraftCallable', () => {
  beforeEach(() => { vi.clearAllMocks(); usageLogAdd.mockResolvedValue(undefined); vi.mocked(checkAiQuota).mockResolvedValue(undefined); vi.mocked(consumeAiQuota).mockResolvedValue(undefined) })

  it('returns the generated draft even when consumeAiQuota bookkeeping fails after a successful generation (Finding 4)', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    generateText.mockResolvedValueOnce(JSON.stringify({ title: 'タイトル', description: '概要' }))
    vi.mocked(consumeAiQuota).mockRejectedValueOnce(new Error('firestore write failed'))
    await expect(generateLessonDraftCallable.run(request())).resolves.toEqual({ title: 'タイトル', description: '概要' })
    expect(usageLogAdd).toHaveBeenCalledWith(expect.objectContaining({ feature: 'LESSON_DRAFT', succeeded: true }))
  })

  it('rejects unauthenticated callers', async () => { await expect(generateLessonDraftCallable.run(request(null as never))).rejects.toMatchObject({ code: 'unauthenticated' }) })

  it('rejects while the organization has AI disabled without logging a usage attempt or checking quota', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => false })
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(usageLogAdd).not.toHaveBeenCalled()
    expect(checkAiQuota).not.toHaveBeenCalled()
  })

  it('rejects with resource-exhausted when the daily or monthly quota is exceeded, without calling the provider', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    vi.mocked(checkAiQuota).mockRejectedValueOnce(new AiQuotaExceededError('DAILY'))
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'resource-exhausted', message: '本日のAI利用上限に達しました' })
    expect(usageLogAdd).not.toHaveBeenCalled()
  })

  it('rejects with unavailable when the kill switch is enabled', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    vi.mocked(checkAiQuota).mockRejectedValueOnce(new AiKillSwitchEnabledError())
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'unavailable' })
    expect(usageLogAdd).not.toHaveBeenCalled()
  })

  it('logs provider failure, returns a safe unavailable error, and does not consume quota', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'unavailable' })
    expect(usageLogAdd).toHaveBeenCalledWith(expect.objectContaining({ feature: 'LESSON_DRAFT', succeeded: false }))
    expect(consumeAiQuota).not.toHaveBeenCalled()
  })

  it('accepts optional material texts', async () => { orgGet.mockResolvedValueOnce({ exists: true, get: () => true }); await expect(generateLessonDraftCallable.run(request(teacher, { materialTexts: ['資料の内容'] }))).rejects.toMatchObject({ code: 'unavailable' }) })
})

describe('generateTeacherGuidanceCallable', () => {
  beforeEach(() => { vi.clearAllMocks(); usageLogAdd.mockResolvedValue(undefined); vi.mocked(checkAiQuota).mockResolvedValue(undefined); vi.mocked(consumeAiQuota).mockResolvedValue(undefined) })

  it('rejects with resource-exhausted when the monthly quota is exceeded', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    vi.mocked(checkAiQuota).mockRejectedValueOnce(new AiQuotaExceededError('MONTHLY'))
    await expect(generateTeacherGuidanceCallable.run(guidanceRequest())).rejects.toMatchObject({ code: 'resource-exhausted', message: '今月のAI利用上限に達しました' })
    expect(usageLogAdd).not.toHaveBeenCalled()
  })

  it('returns the generated guidance even when consumeAiQuota bookkeeping fails after a successful generation (Finding 4)', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    generateText.mockResolvedValueOnce(JSON.stringify({ teacherGuidance: '下書き' }))
    vi.mocked(consumeAiQuota).mockRejectedValueOnce(new Error('firestore write failed'))
    await expect(generateTeacherGuidanceCallable.run(guidanceRequest())).resolves.toEqual({ teacherGuidance: '下書き' })
    expect(usageLogAdd).toHaveBeenCalledWith(expect.objectContaining({ feature: 'TEACHER_GUIDANCE', succeeded: true }))
  })
})
