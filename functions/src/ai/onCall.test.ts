import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  generateLessonDraftCallable,
  generateTeacherGuidanceCallable,
  getMyAiBetaAccessCallable,
  listAiBetaAccessCallable,
  grantAiBetaAccessCallable,
  revokeAiBetaAccessCallable,
} from './onCall'
import { AiKillSwitchEnabledError, AiQuotaExceededError, checkAiQuota, consumeAiQuota } from './usageQuota'
import {
  AiBetaIdempotencyMismatchError,
  AiBetaTargetIneligibleError,
  AiBetaTargetNotFoundError,
  grantAiBetaAccess,
  listApprovedAiBetaAccess,
  revokeAiBetaAccess,
} from './betaAccess'

const orgGet = vi.fn()
const betaAccessGet = vi.fn()
const usageLogAdd = vi.fn()

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', delete: () => 'DELETE_FIELD' },
  getFirestore: () => ({
    doc: (path: string) =>
      path.startsWith('aiBetaAccess/')
        ? { get: betaAccessGet }
        : { get: orgGet },
    collection: () => ({ add: usageLogAdd }),
  }),
}))

vi.mock('./usageQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./usageQuota')>()
  return { ...actual, checkAiQuota: vi.fn(), consumeAiQuota: vi.fn(), getAiUsageQuotaDepsWithAdminSdk: () => ({}) }
})

vi.mock('./betaAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./betaAccess')>()
  return {
    ...actual,
    grantAiBetaAccess: vi.fn(),
    revokeAiBetaAccess: vi.fn(),
    listApprovedAiBetaAccess: vi.fn(),
    getAiBetaAccessDepsWithAdminSdk: () => ({}),
  }
})

const generateText = vi.fn()
vi.mock('./llmProvider', () => ({ unconfiguredLlmProvider: { generateText: (...args: unknown[]) => generateText(...args) } }))

const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']
const operatorAuth = { uid: 'operator-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' }, operator: true } } as unknown as CallableRequest['auth']

const request = (auth = teacher, data: Record<string, unknown> = {}): CallableRequest => ({ auth, data: { theme: 'テーマ', mainObjective: '目標', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD', ...data }, rawRequest: {} } as unknown as CallableRequest)
const guidanceRequest = (auth = teacher, data: Record<string, unknown> = { topic: 'トピック' }): CallableRequest => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

describe('generateLessonDraftCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usageLogAdd.mockResolvedValue(undefined)
    vi.mocked(checkAiQuota).mockResolvedValue(undefined)
    vi.mocked(consumeAiQuota).mockResolvedValue(undefined)
    betaAccessGet.mockResolvedValue({
      exists: true,
      get: (f: string) => (f === 'status' ? 'APPROVED' : undefined),
    })
  })

  it('rejects callers absent from aiBetaAccess without touching the organization', async () => {
    betaAccessGet.mockResolvedValueOnce({ exists: false, get: () => undefined })
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(orgGet).not.toHaveBeenCalled()
  })

  it('rejects callers with REVOKED status without touching the organization', async () => {
    betaAccessGet.mockResolvedValueOnce({ exists: true, get: (f: string) => (f === 'status' ? 'REVOKED' : undefined) })
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(orgGet).not.toHaveBeenCalled()
  })

  it('rejects callers with legacy record missing status', async () => {
    betaAccessGet.mockResolvedValueOnce({ exists: true, get: () => undefined })
    await expect(generateLessonDraftCallable.run(request())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(orgGet).not.toHaveBeenCalled()
  })

  it('rejects operator without self AI beta approval (Finding: operator still requires personal approval)', async () => {
    betaAccessGet.mockResolvedValueOnce({ exists: false, get: () => undefined })
    await expect(generateLessonDraftCallable.run(request(operatorAuth))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(orgGet).not.toHaveBeenCalled()
  })

  it('returns the generated draft even when consumeAiQuota bookkeeping fails after a successful generation (Finding 4)', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    generateText.mockResolvedValueOnce(JSON.stringify({ title: 'タイトル', description: '概要' }))
    vi.mocked(consumeAiQuota).mockRejectedValueOnce(new Error('firestore write failed'))
    await expect(generateLessonDraftCallable.run(request())).resolves.toEqual({ title: 'タイトル', description: '概要' })
    expect(usageLogAdd).toHaveBeenCalledWith(expect.objectContaining({ feature: 'LESSON_DRAFT', succeeded: true }))
  })

  it('rejects unauthenticated callers', async () => {
    await expect(generateLessonDraftCallable.run(request(null as never))).rejects.toMatchObject({ code: 'unauthenticated' })
  })

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

  it('accepts optional material texts', async () => {
    orgGet.mockResolvedValueOnce({ exists: true, get: () => true })
    await expect(generateLessonDraftCallable.run(request(teacher, { materialTexts: ['資料の内容'] }))).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('generateTeacherGuidanceCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usageLogAdd.mockResolvedValue(undefined)
    vi.mocked(checkAiQuota).mockResolvedValue(undefined)
    vi.mocked(consumeAiQuota).mockResolvedValue(undefined)
    betaAccessGet.mockResolvedValue({
      exists: true,
      get: (f: string) => (f === 'status' ? 'APPROVED' : undefined),
    })
  })

  it('rejects callers the operator has not approved for the AI beta', async () => {
    betaAccessGet.mockResolvedValueOnce({ exists: false, get: () => undefined })
    await expect(generateTeacherGuidanceCallable.run(guidanceRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(orgGet).not.toHaveBeenCalled()
  })

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

describe('getMyAiBetaAccessCallable', () => {
  const makeRequest = (auth: typeof teacher) =>
    ({ auth, data: {}, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers', async () => {
    await expect(getMyAiBetaAccessCallable.run(makeRequest(null as never))).rejects.toMatchObject({
      code: 'unauthenticated',
    })
  })

  it('rejects non-teacher callers', async () => {
    const studentAuth = { uid: 'student-1', token: { firebase: {} } } as unknown as CallableRequest['auth']
    await expect(getMyAiBetaAccessCallable.run(makeRequest(studentAuth))).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('returns approved: true when status is APPROVED', async () => {
    betaAccessGet.mockResolvedValueOnce({
      exists: true,
      get: (f: string) => (f === 'status' ? 'APPROVED' : undefined),
    })
    const res = await getMyAiBetaAccessCallable.run(makeRequest(teacher))
    expect(res).toEqual({ approved: true })
  })

  it('returns approved: false when record is absent or not APPROVED', async () => {
    betaAccessGet.mockResolvedValueOnce({ exists: false, get: () => undefined })
    const res1 = await getMyAiBetaAccessCallable.run(makeRequest(teacher))
    expect(res1).toEqual({ approved: false })

    betaAccessGet.mockResolvedValueOnce({
      exists: true,
      get: (f: string) => (f === 'status' ? 'REVOKED' : undefined),
    })
    const res2 = await getMyAiBetaAccessCallable.run(makeRequest(teacher))
    expect(res2).toEqual({ approved: false })
  })
})

describe('listAiBetaAccessCallable', () => {
  const makeRequest = (auth: typeof teacher) =>
    ({ auth, data: {}, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-operator callers before calling core list', async () => {
    await expect(listAiBetaAccessCallable.run(makeRequest(teacher))).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(listApprovedAiBetaAccess).not.toHaveBeenCalled()
  })

  it('returns approved list for operator caller', async () => {
    const mockList = [
      {
        teacherUid: 't-1',
        email: 't1@example.com',
        approvedByUid: 'op-1',
        approvedAtMillis: 1700000000000,
      },
    ]
    vi.mocked(listApprovedAiBetaAccess).mockResolvedValueOnce(mockList)

    const res = await listAiBetaAccessCallable.run(makeRequest(operatorAuth))
    expect(res).toEqual(mockList)
    expect(listApprovedAiBetaAccess).toHaveBeenCalled()
  })
})

describe('grantAiBetaAccessCallable', () => {
  const makeRequest = (auth: typeof teacher, data: Record<string, unknown>) =>
    ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-operator callers', async () => {
    await expect(
      grantAiBetaAccessCallable.run(
        makeRequest(teacher, {
          email: 't@example.com',
          reason: 'r',
          idempotencyKey: 'k',
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' })
    expect(grantAiBetaAccess).not.toHaveBeenCalled()
  })

  it('rejects old targetUid payload with invalid-argument', async () => {
    await expect(
      grantAiBetaAccessCallable.run(makeRequest(operatorAuth, { targetUid: 'teacher-b' })),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(grantAiBetaAccess).not.toHaveBeenCalled()
  })

  it('rejects empty strings in email, reason, or idempotencyKey', async () => {
    await expect(
      grantAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          email: ' ',
          reason: 'reason',
          idempotencyKey: 'key',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })

    await expect(
      grantAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          email: 'test@example.com',
          reason: '   ',
          idempotencyKey: 'key',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })

    await expect(
      grantAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          email: 'test@example.com',
          reason: 'reason',
          idempotencyKey: '  ',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(grantAiBetaAccess).not.toHaveBeenCalled()
  })

  it('maps AiBetaTargetNotFoundError to not-found', async () => {
    vi.mocked(grantAiBetaAccess).mockRejectedValueOnce(
      new AiBetaTargetNotFoundError('Target not found'),
    )
    await expect(
      grantAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          email: 'missing@example.com',
          reason: 'test',
          idempotencyKey: 'k1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('maps AiBetaTargetIneligibleError and AiBetaIdempotencyMismatchError to failed-precondition', async () => {
    vi.mocked(grantAiBetaAccess).mockRejectedValueOnce(
      new AiBetaTargetIneligibleError('Ineligible'),
    )
    await expect(
      grantAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          email: 'ineligible@example.com',
          reason: 'test',
          idempotencyKey: 'k1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })

    vi.mocked(grantAiBetaAccess).mockRejectedValueOnce(
      new AiBetaIdempotencyMismatchError('Mismatch'),
    )
    await expect(
      grantAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          email: 'mismatch@example.com',
          reason: 'test',
          idempotencyKey: 'k1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('returns mutation result on success', async () => {
    vi.mocked(grantAiBetaAccess).mockResolvedValueOnce({
      changed: true,
      teacherUid: 't-123',
      deduplicated: false,
    })

    const res = await grantAiBetaAccessCallable.run(
      makeRequest(operatorAuth, {
        email: 'teacher@example.com',
        reason: 'Authorized beta participant',
        idempotencyKey: 'key-123',
      }),
    )

    expect(res).toEqual({
      changed: true,
      teacherUid: 't-123',
      deduplicated: false,
    })
    expect(grantAiBetaAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: 'teacher@example.com',
        reason: 'Authorized beta participant',
        idempotencyKey: 'key-123',
        actorUid: 'operator-1',
      }),
    )
  })
})

describe('revokeAiBetaAccessCallable', () => {
  const makeRequest = (auth: typeof teacher, data: Record<string, unknown>) =>
    ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-operator callers', async () => {
    await expect(
      revokeAiBetaAccessCallable.run(
        makeRequest(teacher, {
          teacherUid: 't-1',
          reason: 'r',
          idempotencyKey: 'k',
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' })
    expect(revokeAiBetaAccess).not.toHaveBeenCalled()
  })

  it('rejects empty arguments', async () => {
    await expect(
      revokeAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          teacherUid: '  ',
          reason: 'r',
          idempotencyKey: 'k',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(revokeAiBetaAccess).not.toHaveBeenCalled()
  })

  it('maps AiBetaIdempotencyMismatchError to failed-precondition', async () => {
    vi.mocked(revokeAiBetaAccess).mockRejectedValueOnce(
      new AiBetaIdempotencyMismatchError('Mismatch'),
    )
    await expect(
      revokeAiBetaAccessCallable.run(
        makeRequest(operatorAuth, {
          teacherUid: 't-1',
          reason: 'r',
          idempotencyKey: 'k',
        }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('revokes beta access on valid request', async () => {
    vi.mocked(revokeAiBetaAccess).mockResolvedValueOnce({
      changed: true,
      teacherUid: 't-1',
      deduplicated: false,
    })

    const res = await revokeAiBetaAccessCallable.run(
      makeRequest(operatorAuth, {
        teacherUid: 't-1',
        reason: 'Beta phase completed',
        idempotencyKey: 'k-1',
      }),
    )

    expect(res).toEqual({
      changed: true,
      teacherUid: 't-1',
      deduplicated: false,
    })
    expect(revokeAiBetaAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        teacherUid: 't-1',
        reason: 'Beta phase completed',
        idempotencyKey: 'k-1',
        actorUid: 'operator-1',
      }),
    )
  })
})
