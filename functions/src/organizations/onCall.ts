import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { ensurePersonalOrgWithAdminSdk } from './personalOrg'

/** Mirrors src/lib/auth/roles.ts's isTeacherIdentity and firestore.rules' teacher(). */
export const isCallerTeacher = (token: { email_verified?: boolean; firebase?: { sign_in_provider?: string } }): boolean =>
  token.email_verified === true && token.firebase?.sign_in_provider === 'google.com'

export const ensurePersonalOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  return ensurePersonalOrgWithAdminSdk(request.auth.uid)
})
