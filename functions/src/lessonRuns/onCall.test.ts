import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { createLessonRunCallable, restoreCheckpointCallable } from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createLessonRunWithAdminSdk } from './createLessonRun'
import { restoreCheckpointWithAdminSdk } from './checkpoint'

const templateGetMock = vi.fn()
const docGetMock = vi.fn()

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./createLessonRun', () => ({ createLessonRunWithAdminSdk: vi.fn() }))
vi.mock('./checkpoint', () => ({ restoreCheckpointWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: (path: string) => ({ get: path.startsWith('lessonTemplates/') ? templateGetMock : docGetMock }) }),
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

interface RestoreCheckpointRequest { lessonRunId: string; checkpointId: string; reason: string; idempotencyKey: string }

const makeRestoreRequest = (uid = 'teacher-a'): CallableRequest<RestoreCheckpointRequest> => ({
  auth: {
    uid,
    token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  },
  data: { lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '巻き戻し', idempotencyKey: 'restore-1' },
  rawRequest: {},
} as unknown as CallableRequest<RestoreCheckpointRequest>)

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

describe('restoreCheckpointCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<RestoreCheckpointRequest>
    await expect(restoreCheckpointCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(docGetMock).not.toHaveBeenCalled()
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when the target lessonRun does not exist, never calling restoreCheckpoint', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(false))
    await expect(restoreCheckpointCallable.run(makeRestoreRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER on the run, never calling restoreCheckpoint', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(restoreCheckpointCallable.run(makeRestoreRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not on the run\'s teacherRoles at all, never calling restoreCheckpoint', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(restoreCheckpointCallable.run(makeRestoreRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when the run belongs to a different org than the caller is an active member of, never calling restoreCheckpoint', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-other', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    await expect(restoreCheckpointCallable.run(makeRestoreRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-other', 'teacher-a')
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a suspended member (PRIMARY on the run but inactive in the org), never calling restoreCheckpoint', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    await expect(restoreCheckpointCallable.run(makeRestoreRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when the checkpoint does not exist, surfacing the underlying restoreCheckpoint failure', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockRejectedValue(new Error('Checkpoint not found'))
    await expect(restoreCheckpointCallable.run(makeRestoreRequest())).rejects.toThrow('Checkpoint not found')
    expect(restoreCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '巻き戻し', actorId: 'teacher-a', idempotencyKey: 'restore-1',
    })
  })

  it('allows an ASSISTANT (not just PRIMARY) who is an active org member to restore', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockResolvedValue({ newRestoreGeneration: 1, eventId: 'run-1_1', deduplicated: false })

    await expect(restoreCheckpointCallable.run(makeRestoreRequest())).resolves.toEqual({ newRestoreGeneration: 1, eventId: 'run-1_1', deduplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-1', 'teacher-a')
    expect(restoreCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '巻き戻し', actorId: 'teacher-a', idempotencyKey: 'restore-1',
    })
  })

  it('rejects a request missing a non-empty reason, never touching Firestore', async () => {
    const request = {
      auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
      data: { lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '   ', idempotencyKey: 'restore-1' },
      rawRequest: {},
    } as unknown as CallableRequest<RestoreCheckpointRequest>
    await expect(restoreCheckpointCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(docGetMock).not.toHaveBeenCalled()
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })
})
