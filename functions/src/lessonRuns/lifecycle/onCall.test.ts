import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  abortLessonCallable,
  completeLessonCallable,
  interruptLessonCallable,
  resumeLessonCallable,
} from './onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import {
  abortLessonWithAdminSdk,
  completeLessonWithAdminSdk,
  interruptLessonWithAdminSdk,
  resumeLessonWithAdminSdk,
} from '../recoveryLifecycle'

const docGetMock = vi.fn()

vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('../recoveryLifecycle', () => ({
  interruptLessonWithAdminSdk: vi.fn(),
  resumeLessonWithAdminSdk: vi.fn(),
  completeLessonWithAdminSdk: vi.fn(),
  abortLessonWithAdminSdk: vi.fn(),
}))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: docGetMock }) }),
}))

interface GenericLifecycleRequest {
  lessonRunId: string
  reason: string
  idempotencyKey: string
  interimResults?: Record<string, unknown>
  resumePhaseId?: string | null
  resumeCheckpointId?: string | null
  completedPhaseIds?: string[]
  orgId?: string
}

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

const makeRequest = (
  data: Partial<GenericLifecycleRequest> = {},
  uid = 'teacher-a',
): CallableRequest<GenericLifecycleRequest> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: { lessonRunId: 'run-1', reason: '理由', idempotencyKey: 'idem-1', ...data },
  rawRequest: {},
} as unknown as CallableRequest<GenericLifecycleRequest>)

// Carries a valid reason/idempotencyKey so the auth check under test is the
// one that actually rejects the call, not the earlier input-validation check
// (every Callable here validates reason/idempotencyKey before auth).
const unauthenticatedRequest = {
  auth: undefined,
  data: { lessonRunId: 'run-1', reason: '理由', idempotencyKey: 'idem-1' },
  rawRequest: {},
} as unknown as CallableRequest<GenericLifecycleRequest>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('interruptLessonCallable', () => {
  it('rejects unauthenticated callers without touching Firestore', async () => {
    await expect(interruptLessonCallable.run(unauthenticatedRequest)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when reason is missing', async () => {
    await expect(interruptLessonCallable.run(makeRequest({ reason: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when idempotencyKey is missing', async () => {
    await expect(interruptLessonCallable.run(makeRequest({ idempotencyKey: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when the LessonRun does not exist', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(false))
    await expect(interruptLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(interruptLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(interruptLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(interruptLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ASSISTANT-role teacher (TRANSITION_PHASE is PRIMARY-only)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    await expect(interruptLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(interruptLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('reads orgId from the LessonRun doc, ignoring any orgId the client sends, and calls requireActiveOrgMember with it', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'real-org', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(interruptLessonWithAdminSdk).mockResolvedValue({ transition: { status: 'INTERRUPTED', currentPhaseId: null, deduplicated: false }, eventId: 'evt-1' })

    await interruptLessonCallable.run(makeRequest({ orgId: 'attacker-supplied-org' }))

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'real-org', 'teacher-a')
    expect(interruptLessonWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'real-org' }))
  })

  it('proceeds for a PRIMARY-role teacher, forwarding all request fields to interruptLessonWithAdminSdk', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(interruptLessonWithAdminSdk).mockResolvedValue({ transition: { status: 'INTERRUPTED', currentPhaseId: 'phase-a', deduplicated: false }, eventId: 'evt-1' })

    await expect(interruptLessonCallable.run(makeRequest({
      reason: '停電', interimResults: { cash: 500 }, resumePhaseId: 'phase-a', resumeCheckpointId: 'cp-1', idempotencyKey: 'idem-1',
    }))).resolves.toEqual({ transition: { status: 'INTERRUPTED', currentPhaseId: 'phase-a', deduplicated: false }, eventId: 'evt-1' })

    expect(interruptLessonWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', orgId: 'org-1', reason: '停電', interimResults: { cash: 500 },
      resumePhaseId: 'phase-a', resumeCheckpointId: 'cp-1', idempotencyKey: 'idem-1', actorId: 'teacher-a',
    })
  })

  it('defaults optional interrupt fields when the client omits them', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(interruptLessonWithAdminSdk).mockResolvedValue({ transition: { status: 'INTERRUPTED', currentPhaseId: null, deduplicated: false }, eventId: 'evt-1' })

    await interruptLessonCallable.run(makeRequest())

    expect(interruptLessonWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      interimResults: {}, resumePhaseId: null, resumeCheckpointId: null,
    }))
  })

  it.each([
    ['LessonRun not found', 'not-found'],
    ['Invalid status transition: RUNNING -> INTERRUPTED', 'failed-precondition'],
    ['Idempotency key payload mismatch', 'failed-precondition'],
  ] as const)('translates a bare "%s" Error from interruptLesson into %s', async (message, code) => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(interruptLessonWithAdminSdk).mockRejectedValue(new Error(message))

    await expect(interruptLessonCallable.run(makeRequest())).rejects.toMatchObject({ code, message })
  })
})

describe('resumeLessonCallable', () => {
  it('rejects unauthenticated callers without touching Firestore', async () => {
    await expect(resumeLessonCallable.run(unauthenticatedRequest)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when reason or idempotencyKey is missing', async () => {
    await expect(resumeLessonCallable.run(makeRequest({ reason: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(resumeLessonCallable.run(makeRequest({ idempotencyKey: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(resumeLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(resumeLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ASSISTANT-role teacher (TRANSITION_PHASE is PRIMARY-only)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    await expect(resumeLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(resumeLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('checks org membership using the orgId read from the LessonRun doc', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'real-org', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(resumeLessonWithAdminSdk).mockResolvedValue({ status: 'WAITING', currentPhaseId: null, deduplicated: false })

    await resumeLessonCallable.run(makeRequest())

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'real-org', 'teacher-a')
  })

  it('proceeds for a PRIMARY-role teacher, calling resumeLessonWithAdminSdk with the request fields', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(resumeLessonWithAdminSdk).mockResolvedValue({ status: 'WAITING', currentPhaseId: 'phase-a', deduplicated: false })

    await expect(resumeLessonCallable.run(makeRequest({ reason: '再開準備完了', idempotencyKey: 'resume-1' })))
      .resolves.toEqual({ status: 'WAITING', currentPhaseId: 'phase-a', deduplicated: false })

    expect(resumeLessonWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', reason: '再開準備完了', idempotencyKey: 'resume-1', actorId: 'teacher-a',
    })
  })

  it.each([
    ['LessonRun not found', 'not-found'],
    ['Invalid status transition: WAITING -> WAITING', 'failed-precondition'],
    ['Idempotency key payload mismatch', 'failed-precondition'],
  ] as const)('translates a bare "%s" Error from resumeLesson into %s', async (message, code) => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(resumeLessonWithAdminSdk).mockRejectedValue(new Error(message))

    await expect(resumeLessonCallable.run(makeRequest())).rejects.toMatchObject({ code, message })
  })
})

describe('completeLessonCallable', () => {
  it('rejects unauthenticated callers without touching Firestore', async () => {
    await expect(completeLessonCallable.run(unauthenticatedRequest)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when reason or idempotencyKey is missing', async () => {
    await expect(completeLessonCallable.run(makeRequest({ reason: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(completeLessonCallable.run(makeRequest({ idempotencyKey: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(completeLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(completeLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ASSISTANT-role teacher (END_LESSON is PRIMARY-only)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    await expect(completeLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(completeLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (END_LESSON is PRIMARY-only)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(completeLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(completeLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds for a PRIMARY-role teacher, calling completeLessonWithAdminSdk with the request fields', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(completeLessonWithAdminSdk).mockResolvedValue({
      finalResults: {}, checkpointId: 'cp-final', transition: { status: 'REFLECTION', currentPhaseId: null, deduplicated: false },
    })

    await expect(completeLessonCallable.run(makeRequest({ reason: '通常終了', idempotencyKey: 'complete-1' })))
      .resolves.toEqual({ finalResults: {}, checkpointId: 'cp-final', transition: { status: 'REFLECTION', currentPhaseId: null, deduplicated: false } })

    expect(completeLessonWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', reason: '通常終了', idempotencyKey: 'complete-1', actorId: 'teacher-a',
    })
  })

  it.each([
    ['LessonRun not found', 'not-found'],
    ['Invalid status transition: REFLECTION -> REFLECTION', 'failed-precondition'],
    ['Idempotency key payload mismatch', 'failed-precondition'],
  ] as const)('translates a bare "%s" Error from completeLesson into %s', async (message, code) => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(completeLessonWithAdminSdk).mockRejectedValue(new Error(message))

    await expect(completeLessonCallable.run(makeRequest())).rejects.toMatchObject({ code, message })
  })
})

describe('abortLessonCallable', () => {
  it('rejects unauthenticated callers without touching Firestore', async () => {
    await expect(abortLessonCallable.run(unauthenticatedRequest)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects when reason or idempotencyKey is missing', async () => {
    await expect(abortLessonCallable.run(makeRequest({ reason: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(abortLessonCallable.run(makeRequest({ idempotencyKey: '' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(abortLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(abortLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ASSISTANT-role teacher (END_LESSON is PRIMARY-only)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    await expect(abortLessonCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(abortLessonWithAdminSdk).not.toHaveBeenCalled()
  })

  it('reads orgId from the LessonRun doc, ignoring any orgId the client sends', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'real-org', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(abortLessonWithAdminSdk).mockResolvedValue({ transition: { status: 'ABORTED', currentPhaseId: null, deduplicated: false }, eventId: 'evt-2' })

    await abortLessonCallable.run(makeRequest({ orgId: 'attacker-supplied-org' }))

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'real-org', 'teacher-a')
    expect(abortLessonWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'real-org' }))
  })

  it('proceeds for a PRIMARY-role teacher, forwarding completedPhaseIds to abortLessonWithAdminSdk', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(abortLessonWithAdminSdk).mockResolvedValue({ transition: { status: 'ABORTED', currentPhaseId: 'phase-b', deduplicated: false }, eventId: 'evt-2' })

    await expect(abortLessonCallable.run(makeRequest({
      reason: '機材故障', completedPhaseIds: ['phase-a'], idempotencyKey: 'abort-1',
    }))).resolves.toEqual({ transition: { status: 'ABORTED', currentPhaseId: 'phase-b', deduplicated: false }, eventId: 'evt-2' })

    expect(abortLessonWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', orgId: 'org-1', reason: '機材故障', completedPhaseIds: ['phase-a'],
      idempotencyKey: 'abort-1', actorId: 'teacher-a',
    })
  })

  it('defaults completedPhaseIds to an empty array when the client omits it', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(abortLessonWithAdminSdk).mockResolvedValue({ transition: { status: 'ABORTED', currentPhaseId: null, deduplicated: false }, eventId: 'evt-2' })

    await abortLessonCallable.run(makeRequest())

    expect(abortLessonWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({ completedPhaseIds: [] }))
  })

  it.each([
    ['LessonRun not found', 'not-found'],
    ['Invalid status transition: REFLECTION -> ABORTED', 'failed-precondition'],
    ['Idempotency key payload mismatch', 'failed-precondition'],
  ] as const)('translates a bare "%s" Error from abortLesson into %s', async (message, code) => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(abortLessonWithAdminSdk).mockRejectedValue(new Error(message))

    await expect(abortLessonCallable.run(makeRequest())).rejects.toMatchObject({ code, message })
  })
})
