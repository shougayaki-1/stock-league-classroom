import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { generateLessonDraftCallable } from './onCall'

const orgGet = vi.fn()
const usageLogAdd = vi.fn()
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: orgGet }), collection: () => ({ add: usageLogAdd }) }) }))
const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']
const request = (auth = teacher, data: Record<string, unknown> = {}): CallableRequest => ({ auth, data: { theme: 'テーマ', mainObjective: '目標', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD', ...data }, rawRequest: {} } as unknown as CallableRequest)

describe('generateLessonDraftCallable', () => {
  beforeEach(() => { vi.clearAllMocks(); usageLogAdd.mockResolvedValue(undefined) })
  it('rejects unauthenticated callers', async () => { await expect(generateLessonDraftCallable.run(request(null as never))).rejects.toMatchObject({ code: 'unauthenticated' }) })
  it('rejects while the organization has AI disabled without logging a usage attempt', async () => { orgGet.mockResolvedValueOnce({ exists: true, get: () => false }); await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'failed-precondition' }); expect(usageLogAdd).not.toHaveBeenCalled() })
  it('logs provider failure and returns a safe unavailable error', async () => { orgGet.mockResolvedValueOnce({ exists: true, get: () => true }); await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'unavailable' }); expect(usageLogAdd).toHaveBeenCalledWith(expect.objectContaining({ feature: 'LESSON_DRAFT', succeeded: false })) })
})
