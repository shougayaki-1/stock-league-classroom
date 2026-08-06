import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { createLessonRunCallable } from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createLessonRunWithAdminSdk } from './createLessonRun'

const templateGetMock = vi.fn()

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./createLessonRun', () => ({ createLessonRunWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: templateGetMock }) }),
}))

interface CreateLessonRunRequest { templateId: string; lessonRunIdempotencyKey: string }

const makeRequest = (uid = 'teacher-a'): CallableRequest<CreateLessonRunRequest> => ({
  auth: {
    uid,
    token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  },
  data: { templateId: 'template-1', lessonRunIdempotencyKey: 'key-1' },
  rawRequest: {},
} as unknown as CallableRequest<CreateLessonRunRequest>)

describe('createLessonRunCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<CreateLessonRunRequest>
    await expect(createLessonRunCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(templateGetMock).not.toHaveBeenCalled()
    expect(createLessonRunWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when the template does not exist, creating zero run or idempotency documents', async () => {
    templateGetMock.mockResolvedValue({ exists: false, get: () => undefined })
    await expect(createLessonRunCallable.run(makeRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(createLessonRunWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects with permission-denied when the caller has no active org membership (missing or suspended), creating zero run or idempotency documents', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'personal_teacher-a' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))

    await expect(createLessonRunCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'personal_teacher-a', 'teacher-a')
    // requireActiveOrgMember throws for both a missing membership doc and a
    // suspended one; either way createLessonRunWithAdminSdk — the only writer
    // of lessonRuns/lessonRunIdempotency documents — must never be reached.
    expect(createLessonRunWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds to create a run for an active member of the template\'s personal organization', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'personal_teacher-a' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createLessonRunWithAdminSdk).mockResolvedValue({ lessonRunId: 'run-1', created: true })

    await expect(createLessonRunCallable.run(makeRequest())).resolves.toEqual({ lessonRunId: 'run-1', created: true })

    expect(createLessonRunWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'personal_teacher-a', templateId: 'template-1',
      primaryTeacherUid: 'teacher-a', lessonRunIdempotencyKey: 'key-1',
    })
  })

  it('proceeds to create a run for an active member of a non-personal (school) organization', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'school-1' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(createLessonRunWithAdminSdk).mockResolvedValue({ lessonRunId: 'run-2', created: true })

    await expect(createLessonRunCallable.run(makeRequest('teacher-b'))).resolves.toEqual({ lessonRunId: 'run-2', created: true })

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'school-1', 'teacher-b')
    expect(createLessonRunWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'school-1', templateId: 'template-1',
      primaryTeacherUid: 'teacher-b', lessonRunIdempotencyKey: 'key-1',
    })
  })

  it('never accepts orgId from client input, always resolving it from the stored template', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'personal_teacher-a' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createLessonRunWithAdminSdk).mockResolvedValue({ lessonRunId: 'run-1', created: true })

    const request = {
      auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
      data: { templateId: 'template-1', lessonRunIdempotencyKey: 'key-1', orgId: 'attacker-supplied-org' },
      rawRequest: {},
    } as unknown as CallableRequest<CreateLessonRunRequest>

    await createLessonRunCallable.run(request)

    expect(createLessonRunWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'personal_teacher-a' }))
  })
})
