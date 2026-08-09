import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  acceptInvitationCallable,
  createInvitationCallable,
  createSchoolOrgCallable,
  getOrgPlanLimitsCallable,
  isCallerTeacher,
  listOrgMembersCallable,
  listMyInvitationsCallable,
  suspendOrgMemberCallable,
} from './onCall'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { requireActiveOrgMember } from './authorization'
import { createSchoolOrgWithAdminSdk } from './schoolOrg'
import { acceptInvitationWithAdminSdk, createInvitationWithAdminSdk, listMyInvitationsWithAdminSdk } from './invitations'
import { getOrgPlanLimitsWithAdminSdk } from './planLimits'
import { listOrgMembersWithAdminSdk } from './orgMembers'
import { suspendOrgMemberWithAdminSdk } from './suspendMember'

vi.mock('./authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./schoolOrg', () => ({ createSchoolOrgWithAdminSdk: vi.fn() }))
vi.mock('./invitations', () => ({
  acceptInvitationWithAdminSdk: vi.fn(),
  createInvitationWithAdminSdk: vi.fn(),
  listMyInvitationsWithAdminSdk: vi.fn(),
}))
vi.mock('./planLimits', () => ({ getOrgPlanLimitsWithAdminSdk: vi.fn() }))
vi.mock('./orgMembers', () => ({ listOrgMembersWithAdminSdk: vi.fn() }))
vi.mock('./suspendMember', () => ({ suspendOrgMemberWithAdminSdk: vi.fn() }))
const docGetMock = vi.fn()
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: docGetMock }) }) }))

const teacher = {
  uid: 'teacher-1',
  token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
} as unknown as CallableRequest['auth']

describe('isCallerTeacher', () => {
  it('accepts a verified google.com sign-in', () => {
    expect(isCallerTeacher({ email_verified: true, firebase: { sign_in_provider: 'google.com' } })).toBe(true)
  })
  it('rejects anonymous sign-in', () => {
    expect(isCallerTeacher({ firebase: { sign_in_provider: 'anonymous' } })).toBe(false)
  })
  it('rejects an unverified email', () => {
    expect(isCallerTeacher({ email_verified: false, firebase: { sign_in_provider: 'google.com' } })).toBe(false)
  })
})

describe('createSchoolOrgCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an empty name', async () => {
    const request = { auth: teacher, data: { name: '' } } as unknown as CallableRequest
    await expect(createSchoolOrgCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('creates a school org for an authenticated teacher', async () => {
    vi.mocked(createSchoolOrgWithAdminSdk).mockResolvedValueOnce({ orgId: 'school_1' })
    const request = { auth: teacher, data: { name: '桜丘高校' } } as unknown as CallableRequest
    await expect(createSchoolOrgCallable.run(request)).resolves.toEqual({ orgId: 'school_1' })
    expect(createSchoolOrgWithAdminSdk).toHaveBeenCalledWith({ name: '桜丘高校', ownerUid: 'teacher-1' })
  })
})

describe('createInvitationCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a caller whose role is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', email: 'x@example.com', role: 'teacher' } } as unknown as CallableRequest
    await expect(createInvitationCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('creates an invitation for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createInvitationWithAdminSdk).mockResolvedValueOnce({ invitationId: 'invitation-1' })
    const request = { auth: teacher, data: { orgId: 'org-1', email: 'x@example.com', role: 'teacher' } } as unknown as CallableRequest
    await expect(createInvitationCallable.run(request)).resolves.toEqual({ invitationId: 'invitation-1' })
  })
})

describe('acceptInvitationCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the caller uid and verified email through to acceptInvitation', async () => {
    vi.mocked(acceptInvitationWithAdminSdk).mockResolvedValueOnce({ status: 'ACCEPTED' })
    const request = {
      auth: { uid: 'uid-2', token: { email_verified: true, email: 'x@example.com', firebase: { sign_in_provider: 'google.com' } } },
      data: { orgId: 'org-1', invitationId: 'invitation-1' },
    } as unknown as CallableRequest
    await expect(acceptInvitationCallable.run(request)).resolves.toEqual({ status: 'ACCEPTED' })
    expect(acceptInvitationWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'x@example.com',
    })
  })
})

describe('listMyInvitationsCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries by the caller verified email', async () => {
    vi.mocked(listMyInvitationsWithAdminSdk).mockResolvedValueOnce([])
    const request = {
      auth: { uid: 'uid-2', token: { email_verified: true, email: 'x@example.com', firebase: { sign_in_provider: 'google.com' } } },
      data: {},
    } as unknown as CallableRequest
    await expect(listMyInvitationsCallable.run(request)).resolves.toEqual([])
    expect(listMyInvitationsWithAdminSdk).toHaveBeenCalledWith({ email: 'x@example.com' })
  })
})

describe('getOrgPlanLimitsCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires an active org member', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).rejects.toThrow('permission-denied')
  })

  it('returns the resolved plan limits for an active member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
    })
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).resolves.toMatchObject({ participants: 40 })
    expect(getOrgPlanLimitsWithAdminSdk).toHaveBeenCalledWith('org-1')
  })

  it('translates a missing plan into a failed-precondition error', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockRejectedValueOnce(new Error('この組織にはプランが設定されていません'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})

describe('listOrgMembersCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires an active org member', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(listOrgMembersCallable.run(request)).rejects.toThrow('permission-denied')
  })

  it('returns members for an active member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(listOrgMembersWithAdminSdk).mockResolvedValueOnce([
      { uid: 'uid-1', email: 'x@example.com', role: 'owner', status: 'active', membershipVersion: 1 },
    ])
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(listOrgMembersCallable.run(request)).resolves.toEqual([
      { uid: 'uid-1', email: 'x@example.com', role: 'owner', status: 'active', membershipVersion: 1 },
    ])
  })
})

describe('suspendOrgMemberCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a caller whose role is not owner or admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2' } } as unknown as CallableRequest
    await expect(suspendOrgMemberCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('suspends a member for an owner caller', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(suspendOrgMemberWithAdminSdk).mockResolvedValueOnce(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2' } } as unknown as CallableRequest
    await expect(suspendOrgMemberCallable.run(request)).resolves.toBeUndefined()
    expect(suspendOrgMemberWithAdminSdk).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2' })
  })

  it('translates sole-owner protection into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(suspendOrgMemberWithAdminSdk).mockRejectedValueOnce(new Error('組織には少なくとも1人のownerが必要です'))
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2' } } as unknown as CallableRequest
    await expect(suspendOrgMemberCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
