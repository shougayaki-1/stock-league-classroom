import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { ensurePersonalOrgWithAdminSdk } from './personalOrg'
import { createSchoolOrgWithAdminSdk } from './schoolOrg'
import { acceptInvitationWithAdminSdk, createInvitationWithAdminSdk, listMyInvitationsWithAdminSdk } from './invitations'
import { requireActiveOrgMember } from './authorization'
import { getOrgPlanLimitsWithAdminSdk } from './planLimits'
import { listOrgMembersWithAdminSdk } from './orgMembers'
import { suspendOrgMemberWithAdminSdk } from './suspendMember'
import { createParentOrgWithAdminSdk } from './parentOrg'
import { linkSchoolToParentOrgWithAdminSdk, listChildSchoolsWithAdminSdk, unlinkSchoolFromParentOrgWithAdminSdk } from './schoolHierarchy'

/** Mirrors src/lib/auth/roles.ts's isTeacherIdentity and firestore.rules' teacher(). */
export const isCallerTeacher = (token: { email_verified?: boolean; firebase?: { sign_in_provider?: string } }): boolean =>
  token.email_verified === true && token.firebase?.sign_in_provider === 'google.com'

export const ensurePersonalOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  return ensurePersonalOrgWithAdminSdk(request.auth.uid)
})

interface CreateSchoolOrgRequest { name?: unknown }

export const createSchoolOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateSchoolOrgRequest
  if (typeof data.name !== 'string' || data.name.trim().length === 0) throw new HttpsError('invalid-argument', '組織名は必須です。')
  return createSchoolOrgWithAdminSdk({ name: data.name, ownerUid: request.auth.uid })
})

interface CreateInvitationRequest { orgId?: unknown; email?: unknown; role?: unknown }
const isValidInvitationRole = (role: unknown): role is 'admin' | 'teacher' => role === 'admin' || role === 'teacher'

export const createInvitationCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateInvitationRequest
  if (typeof data.orgId !== 'string' || typeof data.email !== 'string' || !data.email.includes('@') || !isValidInvitationRole(data.role)) {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  const db = getFirestore()
  const membership = await requireActiveOrgMember(db, data.orgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new HttpsError('permission-denied', 'owner または admin のみ招待を作成できます。')
  return createInvitationWithAdminSdk({ orgId: data.orgId, email: data.email, role: data.role, invitedByUid: request.auth.uid })
})

interface AcceptInvitationRequest { orgId?: unknown; invitationId?: unknown }

export const acceptInvitationCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as AcceptInvitationRequest
  if (typeof data.orgId !== 'string' || typeof data.invitationId !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const callerEmail = request.auth.token.email as string | undefined
  if (!callerEmail) throw new HttpsError('failed-precondition', 'メールアドレスを確認できません。')
  try {
    return await acceptInvitationWithAdminSdk({ orgId: data.orgId, invitationId: data.invitationId, callerUid: request.auth.uid, callerEmail })
  } catch (error) {
    if (error instanceof Error && error.message === 'あなた宛の招待ではありません') throw new HttpsError('permission-denied', error.message)
    if (error instanceof Error && error.message === 'この招待は既に処理されています') throw new HttpsError('failed-precondition', error.message)
    if (error instanceof Error && error.message === '教師席を整理する必要があります') throw new HttpsError('resource-exhausted', error.message)
    if (error instanceof Error && error.message === '共有枠が不足しています') throw new HttpsError('resource-exhausted', error.message)
    if (error instanceof Error && error.message === '親組織の契約が終了しているため共有枠を利用できません') throw new HttpsError('failed-precondition', error.message)
    throw error
  }
})

export const listMyInvitationsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const callerEmail = request.auth.token.email as string | undefined
  if (!callerEmail) return []
  return listMyInvitationsWithAdminSdk({ email: callerEmail })
})

interface GetOrgPlanLimitsRequest { orgId?: unknown }

export const getOrgPlanLimitsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as GetOrgPlanLimitsRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  try {
    return await getOrgPlanLimitsWithAdminSdk(data.orgId)
  } catch (error) {
    if (error instanceof Error && error.message === 'この組織にはプランが設定されていません') {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
  }
})

interface ListOrgMembersRequest { orgId?: unknown }

export const listOrgMembersCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListOrgMembersRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  return listOrgMembersWithAdminSdk(data.orgId)
})

interface SuspendOrgMemberRequest { orgId?: unknown; uid?: unknown }

export const suspendOrgMemberCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as SuspendOrgMemberRequest
  if (typeof data.orgId !== 'string' || typeof data.uid !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner または admin のみメンバーを解除できます。')
  }
  try {
    await suspendOrgMemberWithAdminSdk({ orgId: data.orgId, uid: data.uid })
  } catch (error) {
    if (error instanceof Error && (error.message === 'このメンバーは既に解除されています' || error.message === '組織には少なくとも1人のownerが必要です')) {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
  }
})

const requireManager = (membership: { role: string }, message: string) => {
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new HttpsError('permission-denied', message)
}
export const createParentOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as { name?: unknown }
  if (typeof data.name !== 'string' || data.name.trim().length === 0) throw new HttpsError('invalid-argument', '組織名は必須です。')
  return createParentOrgWithAdminSdk({ name: data.name, ownerUid: request.auth.uid })
})
export const linkSchoolToParentOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as { parentOrgId?: unknown; schoolOrgId?: unknown }
  if (typeof data.parentOrgId !== 'string' || typeof data.schoolOrgId !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const db = getFirestore()
  requireManager(await requireActiveOrgMember(db, data.parentOrgId, request.auth.uid), '上位組織のowner または admin である必要があります。')
  requireManager(await requireActiveOrgMember(db, data.schoolOrgId, request.auth.uid), '学校組織のowner または admin である必要があります。')
  try { await linkSchoolToParentOrgWithAdminSdk({ parentOrgId: data.parentOrgId, schoolOrgId: data.schoolOrgId }) } catch (error) {
    if (error instanceof Error && (error.message === '対象は上位組織ではありません' || error.message === '対象は学校組織ではありません' || error.message === 'この学校は既に別の上位組織に所属しています' || error.message === '親組織の契約が終了しているため共有枠を利用できません')) throw new HttpsError('failed-precondition', error.message)
    throw error
  }
})
export const unlinkSchoolFromParentOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as { schoolOrgId?: unknown }
  if (typeof data.schoolOrgId !== 'string') throw new HttpsError('invalid-argument', 'schoolOrgId は必須です。')
  const db = getFirestore(); const school = await db.doc(`organizations/${data.schoolOrgId}`).get()
  if (!school.exists) throw new HttpsError('not-found', '学校組織が見つかりません。')
  const parentOrgId = school.get('parentOrgId') as string | undefined
  if (!parentOrgId) throw new HttpsError('failed-precondition', 'この学校はどの上位組織にも所属していません。')
  requireManager(await requireActiveOrgMember(db, parentOrgId, request.auth.uid), '上位組織のowner または admin である必要があります。')
  try {
    await unlinkSchoolFromParentOrgWithAdminSdk({ schoolOrgId: data.schoolOrgId, expectedParentOrgId: parentOrgId })
  } catch (error) {
    if (error instanceof Error && (error.message === '共有枠の予約が残っているため学校を解除できません' || error.message === '学校の所属先が変更されたため解除できません')) {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
  }
})
export const listChildSchoolsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as { parentOrgId?: unknown }
  if (typeof data.parentOrgId !== 'string') throw new HttpsError('invalid-argument', 'parentOrgId は必須です。')
  await requireActiveOrgMember(getFirestore(), data.parentOrgId, request.auth.uid)
  return listChildSchoolsWithAdminSdk({ parentOrgId: data.parentOrgId })
})
