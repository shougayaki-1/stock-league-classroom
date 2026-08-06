import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { personalOrgId } from '../lib/personalOrgId'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { exportPersonalDataWithAdminSdk } from './exportPersonalData'
import {
  purgeHardDeleteResourceWithAdminSdk,
  purgePersonalOrganizationWithAdminSdk,
  requestSoftDeleteWithAdminSdk,
  restoreSoftDeletedWithAdminSdk,
  type ResourceCollection,
} from './deletePersonalData'

const REAUTH_MAX_AGE_SECONDS = 10 * 60
const RESOURCE_COLLECTIONS = new Set<ResourceCollection>(['lessonTemplates', 'lessonRuns'])

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

// ---------------------------------------------------------------------------
// Resource-level Callables: requestSoftDelete / restoreSoftDeleted /
// purgeHardDelete (spec §21.3 priorities 4 and 1, §21.4, §26-9).
// ---------------------------------------------------------------------------

export interface NormalizedResourcePath { collection: ResourceCollection; id: string }

/**
 * Path-traversal / scope defense (Task 12 constraint B). The client supplies
 * a path segment identifying which document to act on, but it must
 * normalize to EXACTLY `lessonTemplates/{id}` or `lessonRuns/{id}` — two
 * segments, one of the two allowed collection names, no `..`, no extra
 * segments, no subcollection paths. This runs before any Firestore read, so
 * a malicious `lessonRuns/run-1/events/e1` or
 * `lessonTemplates/../organizations/other-org` is rejected without ever
 * touching Firestore.
 */
export const normalizeResourcePath = (path: unknown): NormalizedResourcePath => {
  if (typeof path !== 'string' || path.length === 0) {
    throw new HttpsError('invalid-argument', '不正なリソースpathです。')
  }
  const segments = path.split('/')
  if (segments.length !== 2) {
    throw new HttpsError('invalid-argument', '不正なリソースpathです。')
  }
  const [collection, id] = segments
  if (!RESOURCE_COLLECTIONS.has(collection as ResourceCollection)) {
    throw new HttpsError('invalid-argument', '不正なリソースpathです。')
  }
  if (id.length === 0 || id === '.' || id === '..' || id.includes('..')) {
    throw new HttpsError('invalid-argument', '不正なリソースpathです。')
  }
  return { collection: collection as ResourceCollection, id }
}

/**
 * Shared authorization for the three resource-operation Callables: reads the
 * target document's own `orgId` via the Admin SDK — never the client's
 * claim — and requires the caller to be an ACTIVE member of that org
 * (rejects missing/suspended membership and a caller from a different org).
 */
const authorizeResourceOperation = async (uid: string, rawPath: unknown): Promise<{ path: string; orgId: string } & NormalizedResourcePath> => {
  const { collection, id } = normalizeResourcePath(rawPath)
  const path = `${collection}/${id}`
  const firestore = getFirestore()
  const snap = await firestore.doc(path).get()
  if (!snap.exists) throw new HttpsError('not-found', '対象が見つかりません。')
  const orgId = snap.get('orgId') as string | undefined
  if (!orgId) throw new HttpsError('failed-precondition', '対象の組織情報が不正です。')
  await requireActiveOrgMember(firestore, orgId, uid)
  return { collection, id, path, orgId }
}

interface RequestSoftDeleteInput { path: string; reason: string }

export const requestSoftDeleteCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as RequestSoftDeleteInput
  if (!data?.reason?.trim()) throw new HttpsError('invalid-argument', 'reason は必須です。')
  const { path } = await authorizeResourceOperation(request.auth.uid, data.path)
  await requestSoftDeleteWithAdminSdk({ path, reason: data.reason })
  return { path }
})

interface RestoreSoftDeletedInput { path: string }

export const restoreSoftDeletedCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as RestoreSoftDeletedInput
  const { path } = await authorizeResourceOperation(request.auth.uid, data?.path)
  await restoreSoftDeletedWithAdminSdk({ path })
  return { path }
})

interface PurgeHardDeleteInput { path: string; confirm: true; confirmTargetId: string; idempotencyKey: string }

/**
 * Formal/complete single-resource deletion (spec §21.3 priority 1, §26-9)
 * — immediate, no restore path. Never reachable through the accidental-
 * misclick soft-delete UI flow: beyond the same active-membership
 * authorization as the other two resource Callables, this additionally
 * requires `confirm: true` and re-entry of the target's own id as a SECOND,
 * independent field (`confirmTargetId`) — not merely echoing the `path` the
 * client already sent — plus an `idempotencyKey` so a retry after a partial
 * failure resumes via the shared deletion saga instead of restarting or
 * erroring.
 */
export const purgeHardDeleteCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as PurgeHardDeleteInput
  if (data?.confirm !== true || !data.confirmTargetId || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'confirm、confirmTargetId、idempotencyKey は必須です。')
  }
  const { collection, id, orgId } = await authorizeResourceOperation(request.auth.uid, data.path)
  if (data.confirmTargetId !== id) {
    throw new HttpsError('invalid-argument', 'confirmTargetId が対象と一致しません。')
  }
  return purgeHardDeleteResourceWithAdminSdk({
    orgId, collection, id, uid: request.auth.uid, idempotencyKey: data.idempotencyKey,
  })
})

interface PurgePersonalOrganizationInput { confirm: true; confirmUid: string; idempotencyKey: string }

/**
 * Formal whole-personal-org deletion (spec §21.3 priority 1) — the highest-
 * stakes Callable in Task 12. Deliberately mirrors
 * `exportPersonalDataCallable`'s authorization exactly (see that Callable's
 * doc comment): it does NOT require active membership, since a suspended
 * person must still be able to exercise their own formal deletion right.
 * orgId is always `personalOrgId(uid)`, server-derived, never client input.
 * Authorization is: `organizations/{orgId}.ownerUid === uid` (independent of
 * membership status), a fresh sign-in (`isReauthFresh`), `confirm: true`,
 * and re-entry of the caller's own uid as a second field (`confirmUid`) —
 * proof of intent beyond simply being authenticated as that uid.
 *
 * There is intentionally no operator/impersonation path here — if one is
 * ever added it must be a wholly separate Callable requiring its own
 * request id and audit log, per the export Callable's identical carve-out.
 */
export const purgePersonalOrganizationCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isReauthFresh(request.auth.token.auth_time as number | undefined, Date.now())) {
    throw new HttpsError('failed-precondition', 'セキュリティのため、再度サインインしてからお試しください。')
  }
  const data = request.data as PurgePersonalOrganizationInput
  if (data?.confirm !== true || !data.confirmUid || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'confirm、confirmUid、idempotencyKey は必須です。')
  }

  const uid = request.auth.uid
  if (data.confirmUid !== uid) throw new HttpsError('invalid-argument', 'confirmUid が本人と一致しません。')

  const orgId = personalOrgId(uid)
  const orgSnap = await getFirestore().doc(`organizations/${orgId}`).get()
  if (!orgSnap.exists || orgSnap.get('ownerUid') !== uid) {
    throw new HttpsError('permission-denied', '本人の組織のみ削除できます。')
  }

  return purgePersonalOrganizationWithAdminSdk({ uid, orgId, idempotencyKey: data.idempotencyKey })
})
