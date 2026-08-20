import { describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { invalidateJoinCodeCallable, issueJoinCodeCallable } from './onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { invalidateJoinCodeWithAdminSdk, issueJoinCodeWithAdminSdk } from '../joinCodes'

const docGetMock = vi.fn()

vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: docGetMock }) }),
}))
vi.mock('../joinCodes', () => ({
  issueJoinCodeWithAdminSdk: vi.fn(),
  invalidateJoinCodeWithAdminSdk: vi.fn(),
}))

const requireActiveOrgMemberMock = vi.mocked(requireActiveOrgMember)
const issueMock = vi.mocked(issueJoinCodeWithAdminSdk)
const invalidateMock = vi.mocked(invalidateJoinCodeWithAdminSdk)

const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

describe('issueJoinCodeCallable', () => {
  it('rejects an unauthenticated caller', async () => {
    const request = { auth: undefined, data: { lessonRunId: 'run-1' } } as unknown as CallableRequest
    await expect(issueJoinCodeCallable.run(request)).rejects.toThrow('サインインが必要です。')
  })

  it('rejects a non-teacher caller', async () => {
    const request = {
      auth: { uid: 'student-a', token: {} },
      data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest
    await expect(issueJoinCodeCallable.run(request)).rejects.toThrow('教師アカウントのみ利用できます。')
  })

  it('rejects invalid argument when lessonRunId is missing', async () => {
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: {},
    } as unknown as CallableRequest
    await expect(issueJoinCodeCallable.run(request)).rejects.toThrow('lessonRunId は必須です。')
  })

  it('rejects when lessonRun does not exist', async () => {
    docGetMock.mockResolvedValueOnce(makeRunSnap(false))
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: { lessonRunId: 'missing-run' },
    } as unknown as CallableRequest
    await expect(issueJoinCodeCallable.run(request)).rejects.toThrow('レッスンランが見つかりません。')
  })

  it('rejects a teacher with only VIEWER role on this run', async () => {
    docGetMock.mockResolvedValueOnce(
      makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }),
    )
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest
    await expect(issueJoinCodeCallable.run(request)).rejects.toThrow(
      'PRIMARYまたはASSISTANTの教師のみ参加コードを発行できます。',
    )
  })

  it('issues a join code for PRIMARY teacher with active org membership', async () => {
    docGetMock.mockResolvedValueOnce(
      makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }),
    )
    requireActiveOrgMemberMock.mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    issueMock.mockResolvedValueOnce({ code: 'ABCDEF' })

    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest

    const result = await issueJoinCodeCallable.run(request)
    expect(result).toEqual({ code: 'ABCDEF' })
    expect(issueMock).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
  })

  it('issues a join code for ASSISTANT teacher with active org membership', async () => {
    docGetMock.mockResolvedValueOnce(
      makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }),
    )
    requireActiveOrgMemberMock.mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    issueMock.mockResolvedValueOnce({ code: 'XYZ234' })

    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest

    const result = await issueJoinCodeCallable.run(request)
    expect(result).toEqual({ code: 'XYZ234' })
  })

  it('translates failed precondition error when run is not ready/waiting', async () => {
    docGetMock.mockResolvedValueOnce(
      makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }),
    )
    requireActiveOrgMemberMock.mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    issueMock.mockRejectedValueOnce(new Error('LessonRun is not accepting join codes in its current status'))

    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest

    await expect(issueJoinCodeCallable.run(request)).rejects.toThrow(
      'LessonRun is not accepting join codes in its current status',
    )
  })
})

describe('invalidateJoinCodeCallable', () => {
  it('rejects an unauthenticated caller', async () => {
    const request = { auth: undefined, data: { lessonRunId: 'run-1', code: 'ABCDEF' } } as unknown as CallableRequest
    await expect(invalidateJoinCodeCallable.run(request)).rejects.toThrow('サインインが必要です。')
  })

  it('rejects invalid arguments', async () => {
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest
    await expect(invalidateJoinCodeCallable.run(request)).rejects.toThrow('lessonRunId と code は必須です。')
  })

  it('invalidates code for authorized teacher', async () => {
    docGetMock.mockResolvedValueOnce(
      makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }),
    )
    requireActiveOrgMemberMock.mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    invalidateMock.mockResolvedValueOnce(undefined)

    const request = {
      auth: { uid: 'teacher-a', token: teacherToken },
      data: { lessonRunId: 'run-1', code: 'ABCDEF' },
    } as unknown as CallableRequest

    const result = await invalidateJoinCodeCallable.run(request)
    expect(result).toEqual({ success: true })
    expect(invalidateMock).toHaveBeenCalledWith({ code: 'ABCDEF' })
  })
})
