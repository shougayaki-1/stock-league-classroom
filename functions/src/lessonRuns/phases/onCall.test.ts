import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { transitionPhaseCallable } from './onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { transitionPhaseWithAdminSdk } from './transitionPhase'

const docGetMock = vi.fn()

vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./transitionPhase', () => ({ transitionPhaseWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: docGetMock }) }),
}))

interface TransitionPhaseRequest {
  lessonRunId: string
  targetStatus?: string
  targetPhaseId?: string
  reason: string
  idempotencyKey: string
}

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

const makeRequest = (data: Partial<TransitionPhaseRequest> = {}, uid = 'teacher-a'): CallableRequest<TransitionPhaseRequest> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-1', ...data },
  rawRequest: {},
} as unknown as CallableRequest<TransitionPhaseRequest>)

describe('transitionPhaseCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<TransitionPhaseRequest>
    await expect(transitionPhaseCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when neither targetStatus nor targetPhaseId is supplied', async () => {
    await expect(transitionPhaseCallable.run(makeRequest({ targetStatus: undefined, targetPhaseId: undefined })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  // Critical fix: reject targetStatus + targetPhaseId at the Callable's own
  // input-validation boundary too (not only in the pure transitionPhase
  // layer), so a malformed request never reaches Firestore at all.
  it('rejects when both targetStatus and targetPhaseId are supplied', async () => {
    await expect(transitionPhaseCallable.run(makeRequest({ targetStatus: 'RUNNING', targetPhaseId: 'phase-a' })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
    expect(transitionPhaseWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized targetStatus value', async () => {
    await expect(transitionPhaseCallable.run(makeRequest({ targetStatus: 'NOT_A_STATUS' })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when the LessonRun does not exist', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(false))
    await expect(transitionPhaseCallable.run(makeRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(transitionPhaseWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(transitionPhaseCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(transitionPhaseWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ASSISTANT-role teacher (TRANSITION_PHASE is PRIMARY-only)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    await expect(transitionPhaseCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(transitionPhaseWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds for a PRIMARY-role teacher who is an active org member', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(transitionPhaseWithAdminSdk).mockResolvedValue({ status: 'RUNNING', currentPhaseId: null, deduplicated: false })

    await expect(transitionPhaseCallable.run(makeRequest())).resolves.toEqual({ status: 'RUNNING', currentPhaseId: null, deduplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-1', 'teacher-a')
    expect(transitionPhaseWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', targetStatus: 'RUNNING', targetPhaseId: undefined,
      reason: '開始', idempotencyKey: 'tx-1', actorId: 'teacher-a', actorType: 'TEACHER',
    })
  })

  it.each([
    ['LessonRun not found', 'not-found'],
    ['Invalid status transition: WAITING -> RUNNING', 'failed-precondition'],
    ['Idempotency key payload mismatch', 'failed-precondition'],
    ['Nothing to transition: targetStatus or targetPhaseId is required', 'invalid-argument'],
    ['targetStatus and targetPhaseId cannot both be specified in a single transition', 'invalid-argument'],
    ['Lesson failed start validation: HOME_ECONOMICS_MARKET_FORBIDDEN', 'failed-precondition'],
  ] as const)('translates a bare "%s" Error from transitionPhase into %s', async (message, code) => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(transitionPhaseWithAdminSdk).mockRejectedValue(new Error(message))

    await expect(transitionPhaseCallable.run(makeRequest())).rejects.toMatchObject({ code, message })
  })
})
