import { describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { exchangeDisplaySessionTokenCallable, issueDisplaySessionTokenCallable } from './onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { exchangeDisplaySessionTokenWithAdminSdk, issueDisplaySessionTokenWithAdminSdk } from './displaySession'

const docGetMock = vi.fn()

vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: docGetMock }) }) }))
vi.mock('./displaySession', () => ({
  issueDisplaySessionTokenWithAdminSdk: vi.fn(),
  exchangeDisplaySessionTokenWithAdminSdk: vi.fn(),
}))

const requireActiveOrgMemberMock = vi.mocked(requireActiveOrgMember)
const issueMock = vi.mocked(issueDisplaySessionTokenWithAdminSdk)
const exchangeMock = vi.mocked(exchangeDisplaySessionTokenWithAdminSdk)

const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

describe('issueDisplaySessionTokenCallable', () => {
  it('rejects an unauthenticated caller', async () => {
    const request = { auth: undefined, data: { lessonRunId: 'run-1' } } as unknown as CallableRequest
    await expect(issueDisplaySessionTokenCallable.run(request)).rejects.toThrow('サインインが必要です。')
  })

  it('rejects a non-teacher caller', async () => {
    const request = {
      auth: { uid: 'student-a', token: {} }, data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest
    await expect(issueDisplaySessionTokenCallable.run(request)).rejects.toThrow('教師アカウントのみ利用できます。')
  })

  it('rejects a teacher with only VIEWER role on this run', async () => {
    docGetMock.mockResolvedValueOnce(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken }, data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest
    await expect(issueDisplaySessionTokenCallable.run(request)).rejects.toThrow('PRIMARYまたはASSISTANTの教師のみ教室表示URLを発行できます。')
  })

  it('issues a token for a PRIMARY teacher with active org membership', async () => {
    docGetMock.mockResolvedValueOnce(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    requireActiveOrgMemberMock.mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    issueMock.mockResolvedValueOnce({ token: 'plaintext-token' })
    const request = {
      auth: { uid: 'teacher-a', token: teacherToken }, data: { lessonRunId: 'run-1' },
    } as unknown as CallableRequest
    const result = await issueDisplaySessionTokenCallable.run(request)
    expect(result).toEqual({ token: 'plaintext-token' })
    expect(issueMock).toHaveBeenCalledWith({ lessonRunId: 'run-1', orgId: 'org-1' })
  })
})

describe('exchangeDisplaySessionTokenCallable', () => {
  it('does not require request.auth (the projector page is not signed in yet)', async () => {
    exchangeMock.mockResolvedValueOnce({ customToken: 'custom-token-value' })
    const request = { auth: undefined, data: { lessonRunId: 'run-1', token: 'a-token' } } as unknown as CallableRequest
    const result = await exchangeDisplaySessionTokenCallable.run(request)
    expect(result).toEqual({ customToken: 'custom-token-value' })
    expect(exchangeMock).toHaveBeenCalledWith({ lessonRunId: 'run-1', token: 'a-token' })
  })

  it('rejects missing input', async () => {
    const request = { auth: undefined, data: { lessonRunId: 'run-1' } } as unknown as CallableRequest
    await expect(exchangeDisplaySessionTokenCallable.run(request)).rejects.toThrow('lessonRunId と token は必須です。')
  })

  it('translates a not-found token error into HttpsError not-found', async () => {
    exchangeMock.mockRejectedValueOnce(new Error('Display session token not found'))
    const request = { auth: undefined, data: { lessonRunId: 'run-1', token: 'bogus' } } as unknown as CallableRequest
    await expect(exchangeDisplaySessionTokenCallable.run(request)).rejects.toThrow('Display session token not found')
  })
})
