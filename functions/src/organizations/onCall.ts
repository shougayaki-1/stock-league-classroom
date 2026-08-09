import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { ensurePersonalOrgWithAdminSdk } from './personalOrg'
import { createSchoolOrgWithAdminSdk } from './schoolOrg'
import { acceptInvitationWithAdminSdk, createInvitationWithAdminSdk, listMyInvitationsWithAdminSdk } from './invitations'
import { requireActiveOrgMember } from './authorization'

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
