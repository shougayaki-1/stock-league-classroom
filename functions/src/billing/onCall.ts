import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createStripeCheckoutSessionWithAdminSdk, stripeSecretKey } from './stripeCheckout'
import { createStripeCustomerPortalSessionWithAdminSdk } from './stripeCustomerPortal'
export const createStripeCheckoutSessionCallable = onCall({ region: 'asia-northeast1', secrets: [stripeSecretKey] }, async (request) => { if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。'); if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。'); const d = request.data as { orgId?: unknown; planId?: unknown; successUrl?: unknown; cancelUrl?: unknown }; if (typeof d.orgId !== 'string' || typeof d.planId !== 'string' || typeof d.successUrl !== 'string' || typeof d.cancelUrl !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。'); const m = await requireActiveOrgMember(getFirestore(), d.orgId, request.auth.uid); if (m.role !== 'owner' && m.role !== 'admin') throw new HttpsError('permission-denied', 'owner または admin のみ決済を開始できます。'); try { return await createStripeCheckoutSessionWithAdminSdk({ orgId: d.orgId, planId: d.planId, successUrl: d.successUrl, cancelUrl: d.cancelUrl }) } catch (e) { if (e instanceof Error && e.message === 'このプランはまだ決済に対応していません') throw new HttpsError('failed-precondition', e.message); throw new HttpsError('unavailable', '決済セッションの作成に失敗しました。時間をおいて再試行してください。') } })

interface CreateStripeCustomerPortalSessionRequest { orgId?: unknown; returnUrl?: unknown }

export const createStripeCustomerPortalSessionCallable = onCall({ region: 'asia-northeast1', secrets: [stripeSecretKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateStripeCustomerPortalSessionRequest | null
  if (!data || typeof data !== 'object') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  if (typeof data.orgId !== 'string' || typeof data.returnUrl !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner または admin のみ支払い設定を変更できます。')
  }
  try {
    return await createStripeCustomerPortalSessionWithAdminSdk({ orgId: data.orgId, returnUrl: data.returnUrl })
  } catch (error) {
    if (error instanceof Error && error.message === 'まだ決済履歴がありません') throw new HttpsError('failed-precondition', error.message)
    throw new HttpsError('unavailable', 'ポータルセッションの作成に失敗しました。時間をおいて再試行してください。')
  }
})
