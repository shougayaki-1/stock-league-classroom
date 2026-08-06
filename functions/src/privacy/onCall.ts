import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { personalOrgId } from '../lib/personalOrgId'
import { exportPersonalDataWithAdminSdk } from './exportPersonalData'

const REAUTH_MAX_AGE_SECONDS = 10 * 60

/**
 * Recent sign-in ("reauthentication") check for this high-risk export
 * operation. `auth_time` is the Firebase ID token's seconds-since-epoch
 * timestamp of the underlying sign-in event, distinct from the token's own
 * issue/expiry — a long-lived session can carry a stale auth_time. `nowMs`
 * is threaded through as a parameter (rather than calling Date.now()
 * internally) purely so this predicate can be unit-tested deterministically
 * without needing fake timers.
 */
export const isReauthFresh = (authTimeSeconds: number | undefined, nowMs: number): boolean => {
  if (typeof authTimeSeconds !== 'number') return false
  return nowMs / 1000 - authTimeSeconds <= REAUTH_MAX_AGE_SECONDS
}

/**
 * Personal-data export (spec §21.1/§21.7). This Callable deliberately does
 * NOT use requireActiveOrgMember, the guard every other org-scoped Callable
 * in this codebase relies on: membership status ('active'/'suspended') is an
 * org-administration concept, and a person's own right to their own data
 * must not be blockable by an org state they don't fully control. Instead:
 *
 *  - orgId is never accepted from request.data — it is always
 *    personalOrgId(request.auth.uid), so a caller cannot point this at any
 *    org other than their own personal org.
 *  - Authorization is a single, independent Admin SDK check:
 *    organizations/{orgId}.ownerUid === request.auth.uid. For a personal
 *    org this is by definition "am I the owner", not "am I an active
 *    member" — a suspended membership does not change ownerUid, so
 *    self-export still succeeds.
 *  - A fresh sign-in (auth_time within 10 minutes) is required in addition,
 *    since export is a high-risk bulk-read operation.
 *
 * There is intentionally no operator/impersonation path here. If one is
 * ever added it must be a wholly separate Callable requiring an `operator`
 * claim, a distinct request id, and its own audit log — never folded into
 * this self-service path.
 */
export const exportPersonalDataCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isReauthFresh(request.auth.token.auth_time as number | undefined, Date.now())) {
    throw new HttpsError('failed-precondition', 'セキュリティのため、再度サインインしてからお試しください。')
  }

  const uid = request.auth.uid
  const orgId = personalOrgId(uid)
  const orgSnap = await getFirestore().doc(`organizations/${orgId}`).get()
  if (!orgSnap.exists || orgSnap.get('ownerUid') !== uid) {
    throw new HttpsError('permission-denied', '本人のデータのみエクスポートできます。')
  }

  return exportPersonalDataWithAdminSdk(uid, orgId)
})
