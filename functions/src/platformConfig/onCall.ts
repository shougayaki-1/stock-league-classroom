import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireActiveOrgMember } from '../organizations/authorization'
import { isCallerTeacher } from '../organizations/onCall'
import { personalOrgId } from '../lib/personalOrgId'
import { buildTuningConstantsResponse } from './tuningConstantsResponse'

/** Teacher-only, read-only reference endpoint for the platform's provisional constants. */
export const getTuningConstantsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  await requireActiveOrgMember(getFirestore(), personalOrgId(request.auth.uid), request.auth.uid)
  return buildTuningConstantsResponse()
})
