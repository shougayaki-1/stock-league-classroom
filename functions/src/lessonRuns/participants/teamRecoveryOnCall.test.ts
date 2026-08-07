import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  assignParticipantToTeamCallable,
  issueRecoveryCodeCallable,
  recoverParticipantCallable,
  rotateRepresentativeCallable,
} from './onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { issueRecoveryCodeWithAdminSdk, recoverParticipantWithAdminSdk } from '../recovery'
import { assignParticipantToTeamWithAdminSdk, rotateRepresentativeWithAdminSdk } from '../teams/assignTeam'

const runGetMock = vi.fn()

vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('../recovery', () => ({ issueRecoveryCodeWithAdminSdk: vi.fn(), recoverParticipantWithAdminSdk: vi.fn() }))
vi.mock('../teams/assignTeam', () => ({ assignParticipantToTeamWithAdminSdk: vi.fn(), rotateRepresentativeWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: runGetMock }) }),
}))

const teacherRunDoc = (role: string | undefined, orgId = 'org-1') => ({
  exists: true,
  get: (field: string) => (field === 'orgId' ? orgId : field === 'teacherRoles' ? { 'teacher-a': role } : undefined),
})

const makeRequest = <T>(data: T, uid = 'teacher-a'): CallableRequest<T> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data,
  rawRequest: {},
} as unknown as CallableRequest<T>)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assignParticipantToTeamCallable', () => {
  const baseData = { lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'k1' }

  it('rejects unauthenticated callers', async () => {
    const request = { auth: undefined, data: baseData, rawRequest: {} } as unknown as CallableRequest<typeof baseData>
    await expect(assignParticipantToTeamCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(assignParticipantToTeamWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (only PRIMARY/ASSISTANT may control the lesson)', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc('VIEWER'))
    await expect(assignParticipantToTeamCallable.run(makeRequest(baseData))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(assignParticipantToTeamWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacherRoles entry on this run', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc(undefined))
    await expect(assignParticipantToTeamCallable.run(makeRequest(baseData))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('proceeds for a PRIMARY teacher who is an active org member', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc('PRIMARY'))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(assignParticipantToTeamWithAdminSdk).mockResolvedValue({ teamId: 'team-b', version: 1, deduplicated: false })

    await expect(assignParticipantToTeamCallable.run(makeRequest(baseData)))
      .resolves.toEqual({ teamId: 'team-b', version: 1, deduplicated: false })
    expect(assignParticipantToTeamWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'k1', actorId: 'teacher-a',
    })
  })

  it('translates a bare Error into an HttpsError', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc('ASSISTANT'))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(assignParticipantToTeamWithAdminSdk).mockRejectedValue(new Error('Participant is already assigned to a team'))
    await expect(assignParticipantToTeamCallable.run(makeRequest(baseData)))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Participant is already assigned to a team' })
  })
})

describe('rotateRepresentativeCallable', () => {
  const baseData = {
    lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2', reason: '手動交代', idempotencyKey: 'k2',
  }

  it('rejects a caller without PRIMARY/ASSISTANT role', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc('VIEWER'))
    await expect(rotateRepresentativeCallable.run(makeRequest(baseData))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(rotateRepresentativeWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds for an ASSISTANT teacher and forwards actorType TEACHER', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc('ASSISTANT'))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(rotateRepresentativeWithAdminSdk).mockResolvedValue({
      teamId: 'team-a', previousRepresentativeParticipantId: 'p-1', newRepresentativeParticipantId: 'p-2', version: 1, deduplicated: false,
    })

    await rotateRepresentativeCallable.run(makeRequest(baseData))

    expect(rotateRepresentativeWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2',
      reason: '手動交代', idempotencyKey: 'k2', actorId: 'teacher-a', actorType: 'TEACHER',
    }))
  })
})

describe('issueRecoveryCodeCallable', () => {
  const baseData = { lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'k3' }

  it('rejects a caller without PRIMARY/ASSISTANT role', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc('VIEWER'))
    await expect(issueRecoveryCodeCallable.run(makeRequest(baseData))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(issueRecoveryCodeWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds for a PRIMARY teacher and returns the plaintext code', async () => {
    runGetMock.mockResolvedValue(teacherRunDoc('PRIMARY'))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(issueRecoveryCodeWithAdminSdk).mockResolvedValue({ code: 'ABCDEFGHJK', deduplicated: false })

    await expect(issueRecoveryCodeCallable.run(makeRequest(baseData))).resolves.toEqual({ code: 'ABCDEFGHJK', deduplicated: false })
  })
})

describe('recoverParticipantCallable', () => {
  const baseData = { lessonRunId: 'run-1', code: 'ABCDEFGHJK', idempotencyKey: 'k4' }

  it('rejects unauthenticated callers', async () => {
    const request = { auth: undefined, data: baseData, rawRequest: {} } as unknown as CallableRequest<typeof baseData>
    await expect(recoverParticipantCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(recoverParticipantWithAdminSdk).not.toHaveBeenCalled()
  })

  it('does not require any teacher role — a signed-in student holding the code is enough', async () => {
    vi.mocked(recoverParticipantWithAdminSdk).mockResolvedValue({
      participantId: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', oldAuthUid: 'old-uid', newAuthUid: 'student-new',
      previousStatus: 'ACTIVE', sessionVersion: 2, membershipVersion: 5, deduplicated: false,
    })
    await recoverParticipantCallable.run(makeRequest(baseData, 'student-new'))
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(recoverParticipantWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', code: 'ABCDEFGHJK', newAuthUid: 'student-new', idempotencyKey: 'k4',
    })
  })

  it('translates recovery errors', async () => {
    vi.mocked(recoverParticipantWithAdminSdk).mockRejectedValue(new Error('Recovery code has expired'))
    await expect(recoverParticipantCallable.run(makeRequest(baseData, 'student-new')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Recovery code has expired' })
  })
})
