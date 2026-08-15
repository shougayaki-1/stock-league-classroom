import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  acceptInvitationCallable,
  changeOrgMemberRoleCallable,
  createInvitationCallable,
  createSchoolOrgCallable,
  getOrgPlanLimitsCallable,
  isCallerTeacher,
  listOrgInvitationsCallable,
  listOrgMembersCallable,
  listMyInvitationsCallable,
  revokeInvitationCallable,
  suspendOrgMemberCallable,
  createParentOrgCallable,
  linkSchoolToParentOrgCallable,
  listChildSchoolsCallable,
  unlinkSchoolFromParentOrgCallable,
} from './onCall'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { requireActiveOrgMember } from './authorization'
import { createSchoolOrgWithAdminSdk } from './schoolOrg'
import {
  acceptInvitationWithAdminSdk,
  createInvitationWithAdminSdk,
  listMyInvitationsWithAdminSdk,
  listOrgInvitationsWithAdminSdk,
  revokeInvitationWithAdminSdk,
} from './invitations'
import { changeOrgMemberRoleWithAdminSdk } from './changeRole'
import { getOrgPlanLimitsWithAdminSdk } from './planLimits'
import { listOrgMembersWithAdminSdk } from './orgMembers'
import { suspendOrgMemberWithAdminSdk } from './suspendMember'
import { createParentOrgWithAdminSdk } from './parentOrg'
import { linkSchoolToParentOrgWithAdminSdk, listChildSchoolsWithAdminSdk, unlinkSchoolFromParentOrgWithAdminSdk } from './schoolHierarchy'

vi.mock('./authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./schoolOrg', () => ({ createSchoolOrgWithAdminSdk: vi.fn() }))
vi.mock('./invitations', () => ({
  acceptInvitationWithAdminSdk: vi.fn(),
  createInvitationWithAdminSdk: vi.fn(),
  listMyInvitationsWithAdminSdk: vi.fn(),
  listOrgInvitationsWithAdminSdk: vi.fn(),
  revokeInvitationWithAdminSdk: vi.fn(),
}))
vi.mock('./changeRole', () => ({ changeOrgMemberRoleWithAdminSdk: vi.fn() }))
vi.mock('./planLimits', () => ({ getOrgPlanLimitsWithAdminSdk: vi.fn() }))
vi.mock('./orgMembers', () => ({ listOrgMembersWithAdminSdk: vi.fn() }))
vi.mock('./suspendMember', () => ({ suspendOrgMemberWithAdminSdk: vi.fn() }))
vi.mock('./parentOrg', () => ({ createParentOrgWithAdminSdk: vi.fn() }))
vi.mock('./schoolHierarchy', () => ({ linkSchoolToParentOrgWithAdminSdk: vi.fn(), unlinkSchoolFromParentOrgWithAdminSdk: vi.fn(), listChildSchoolsWithAdminSdk: vi.fn() }))

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

  it('translates a restricted teacher-seat invitation into resource-exhausted', async () => {
    vi.mocked(acceptInvitationWithAdminSdk).mockRejectedValueOnce(new Error('教師席を整理する必要があります'))
    const request = {
      auth: { uid: 'uid-2', token: { email_verified: true, email: 'x@example.com', firebase: { sign_in_provider: 'google.com' } } },
      data: { orgId: 'org-1', invitationId: 'invitation-1' },
    } as unknown as CallableRequest

    await expect(acceptInvitationCallable.run(request)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: '教師席を整理する必要があります',
    })
  })

  it('translates parent shared-quota exhaustion into resource-exhausted', async () => {
    vi.mocked(acceptInvitationWithAdminSdk).mockRejectedValueOnce(new Error('共有枠が不足しています'))
    const request = {
      auth: { uid: 'uid-2', token: { email_verified: true, email: 'x@example.com', firebase: { sign_in_provider: 'google.com' } } },
      data: { orgId: 'org-1', invitationId: 'invitation-1' },
    } as unknown as CallableRequest

    await expect(acceptInvitationCallable.run(request)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: '共有枠が不足しています',
    })
  })

  it('translates an ended parent contract into failed-precondition', async () => {
    vi.mocked(acceptInvitationWithAdminSdk).mockRejectedValueOnce(new Error('親組織の契約が終了しているため共有枠を利用できません'))
    const request = {
      auth: { uid: 'uid-2', token: { email_verified: true, email: 'x@example.com', firebase: { sign_in_provider: 'google.com' } } },
      data: { orgId: 'org-1', invitationId: 'invitation-1' },
    } as unknown as CallableRequest

    await expect(acceptInvitationCallable.run(request)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: '親組織の契約が終了しているため共有枠を利用できません',
    })
  })
})

describe('linkSchoolToParentOrgCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('translates an ended parent contract into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember)
      .mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
      .mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(linkSchoolToParentOrgWithAdminSdk).mockRejectedValueOnce(new Error('親組織の契約が終了しているため共有枠を利用できません'))

    await expect(linkSchoolToParentOrgCallable.run({
      auth: teacher,
      data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1' },
    } as unknown as CallableRequest)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: '親組織の契約が終了しているため共有枠を利用できません',
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
      concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, aiCreditsPerDay: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).resolves.toMatchObject({ participants: 40 })
    expect(getOrgPlanLimitsWithAdminSdk).toHaveBeenCalledWith('org-1')
  })

  it('returns downgrade status alongside the plan limits', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, aiCreditsPerDay: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
      downgradeStatus: { state: 'RESTRICTED', violations: [{ key: 'teacherSeats', label: '教師席', used: 2, limit: 1 }] },
    })

    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).resolves.toMatchObject({ downgradeStatus: { state: 'RESTRICTED' } })
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

describe('parent organization hierarchy Callables', () => {
  beforeEach(() => vi.clearAllMocks())
  it('creates a parent org for an authenticated teacher', async () => {
    vi.mocked(createParentOrgWithAdminSdk).mockResolvedValueOnce({ orgId: 'parentOrg_1' })
    await expect(createParentOrgCallable.run({ auth: teacher, data: { name: '桜丘市教育委員会' } } as unknown as CallableRequest)).resolves.toEqual({ orgId: 'parentOrg_1' })
  })
  it('requires owner/admin of both orgs to link a school', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 }).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    vi.mocked(linkSchoolToParentOrgWithAdminSdk).mockResolvedValueOnce(undefined)
    const request = { auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1' } } as unknown as CallableRequest
    await expect(linkSchoolToParentOrgCallable.run(request)).resolves.toBeUndefined()
    expect(linkSchoolToParentOrgWithAdminSdk).toHaveBeenCalledWith({ parentOrgId: 'parent-1', schoolOrgId: 'school-1' })
  })
  it('requires management of the current parent org to unlink', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, get: () => 'parent-1' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 }); vi.mocked(unlinkSchoolFromParentOrgWithAdminSdk).mockResolvedValueOnce(undefined)
    await expect(unlinkSchoolFromParentOrgCallable.run({ auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest)).resolves.toBeUndefined()
    expect(unlinkSchoolFromParentOrgWithAdminSdk).toHaveBeenCalledWith({ schoolOrgId: 'school-1', expectedParentOrgId: 'parent-1' })
  })
  it('returns failed-precondition when a school still has shared-quota reservations', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, get: () => 'parent-1' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    vi.mocked(unlinkSchoolFromParentOrgWithAdminSdk).mockRejectedValueOnce(new Error('共有枠の予約が残っているため学校を解除できません'))
    await expect(unlinkSchoolFromParentOrgCallable.run({ auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest)).rejects.toMatchObject({
      code: 'failed-precondition', message: '共有枠の予約が残っているため学校を解除できません',
    })
  })
  it('returns failed-precondition when the school changes parent after authorization', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, get: () => 'parent-1' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    vi.mocked(unlinkSchoolFromParentOrgWithAdminSdk).mockRejectedValueOnce(new Error('学校の所属先が変更されたため解除できません'))
    await expect(unlinkSchoolFromParentOrgCallable.run({ auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest)).rejects.toMatchObject({
      code: 'failed-precondition', message: '学校の所属先が変更されたため解除できません',
    })
  })
  it('lists child schools for an active parent member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 }); vi.mocked(listChildSchoolsWithAdminSdk).mockResolvedValueOnce([{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }])
    await expect(listChildSchoolsCallable.run({ auth: teacher, data: { parentOrgId: 'parent-1' } } as unknown as CallableRequest)).resolves.toHaveLength(1)
  })
})

describe('listOrgInvitationsCallable', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a caller who is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(listOrgInvitationsCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(listOrgInvitationsWithAdminSdk).not.toHaveBeenCalled()
  })

  it('returns invitations for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(listOrgInvitationsWithAdminSdk).mockResolvedValue([])
    const request = { auth: teacher, data: { orgId: 'org-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(listOrgInvitationsCallable.run(request)).resolves.toEqual([])
    expect(listOrgInvitationsWithAdminSdk).toHaveBeenCalledWith('org-1')
  })
})

describe('revokeInvitationCallable', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a caller who is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', invitationId: 'inv-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(revokeInvitationCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(revokeInvitationWithAdminSdk).not.toHaveBeenCalled()
  })

  it('translates a non-PENDING error into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    vi.mocked(revokeInvitationWithAdminSdk).mockRejectedValue(new Error('この招待は失効できません'))
    const request = { auth: teacher, data: { orgId: 'org-1', invitationId: 'inv-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(revokeInvitationCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('revokes for an admin caller', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    vi.mocked(revokeInvitationWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', invitationId: 'inv-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(revokeInvitationCallable.run(request)).resolves.toBeUndefined()
    expect(revokeInvitationWithAdminSdk).toHaveBeenCalledWith({ orgId: 'org-1', invitationId: 'inv-1' })
  })
})

describe('changeOrgMemberRoleCallable', () => {
  // docGetMock is the existing shared `getFirestore().doc().get` mock at the
  // top of this file. changeOrgMemberRoleCallable reads the TARGET member's
  // current role with it (to decide whether an owner is involved on either
  // side of the change), separately from `requireActiveOrgMember`, which
  // authorizes the CALLER via the mocked `requireActiveOrgMember` itself.
  beforeEach(() => {
    vi.clearAllMocks()
    docGetMock.mockResolvedValue({ exists: true, get: () => 'teacher' }) // target's current role: non-owner by default
  })

  it('rejects a caller who is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(changeOrgMemberRoleWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an admin caller promoting a member to owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'owner' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(changeOrgMemberRoleWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an admin caller demoting an existing owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    docGetMock.mockResolvedValue({ exists: true, get: () => 'owner' }) // target is currently an owner
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(changeOrgMemberRoleWithAdminSdk).not.toHaveBeenCalled()
  })

  it('translates the sole-owner guard error into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockRejectedValue(new Error('組織には少なくとも1人のownerが必要です'))
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('allows an owner to promote a member to owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'owner' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).resolves.toBeUndefined()
    expect(changeOrgMemberRoleWithAdminSdk).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', newRole: 'owner' })
  })

  it('allows an owner to demote an existing owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    docGetMock.mockResolvedValue({ exists: true, get: () => 'owner' })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).resolves.toBeUndefined()
  })

  it('allows an admin to change a role between admin and teacher', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'teacher' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).resolves.toBeUndefined()
  })
})

