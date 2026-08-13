import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { saveBillingProfileWithAdminSdk } from './billingProfileAdmin'
import {
  getBillingOverviewWithAdminSdk,
  startInvoiceSubscriptionWithAdminSdk,
} from './invoiceSubscriptionAdmin'
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

const billingCallableOptions = { region: 'asia-northeast1' as const, secrets: [stripeSecretKey] }

const requireTeacherAuth = (request: CallableRequest): NonNullable<CallableRequest['auth']> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) {
    throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  }
  return request.auth
}

const requestRecord = (data: unknown): Record<string, unknown> => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  return data as Record<string, unknown>
}

const requireBillingManager = async (orgId: string, uid: string): Promise<void> => {
  const membership = await requireActiveOrgMember(getFirestore(), orgId, uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner または admin のみ請求情報を管理できます。')
  }
}

const errorMessage = (error: unknown): string | null => error instanceof Error ? error.message : null

const schoolOnlyError = '請求書払いは学校組織のみ利用できます'
const invoiceSubscriptionPreconditionErrors = new Set([
  '請求先プロフィールの入力内容が不正です',
  'Stripe Customerが登録されていません',
  'このプランはまだ決済に対応していません',
  '請求書払いの申込を処理中です',
  '請求書払いの申込状態が変更されました',
  'カード契約のCustomerが請求先と一致しません',
  '有効なカード契約の更新日を確認できません',
  '有効なカード契約の現在期間を確認できません',
])

export const saveBillingProfileCallable = onCall(billingCallableOptions, async (request) => {
  const requestAuth = requireTeacherAuth(request)
  const data = requestRecord(request.data)
  if (
    typeof data.orgId !== 'string'
    || !data.orgId
    || !data.profile
    || typeof data.profile !== 'object'
    || Array.isArray(data.profile)
  ) throw new HttpsError('invalid-argument', '入力内容が不正です。')
  await requireBillingManager(data.orgId, requestAuth.uid)
  try {
    return await saveBillingProfileWithAdminSdk({
      orgId: data.orgId,
      profile: data.profile as Parameters<typeof saveBillingProfileWithAdminSdk>[0]['profile'],
      actorUid: requestAuth.uid,
    })
  } catch (error) {
    const message = errorMessage(error)
    if (message === '請求先プロフィールの入力内容が不正です') {
      throw new HttpsError('invalid-argument', message)
    }
    if (message === schoolOnlyError) throw new HttpsError('permission-denied', message)
    throw new HttpsError('unavailable', '請求先プロフィールを保存できませんでした。時間をおいて再試行してください。')
  }
})

export const startInvoiceSubscriptionCallable = onCall(billingCallableOptions, async (request) => {
  const requestAuth = requireTeacherAuth(request)
  const data = requestRecord(request.data)
  if (typeof data.orgId !== 'string' || !data.orgId) {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  await requireBillingManager(data.orgId, requestAuth.uid)
  try {
    return await startInvoiceSubscriptionWithAdminSdk({ orgId: data.orgId, actorUid: requestAuth.uid })
  } catch (error) {
    const message = errorMessage(error)
    if (message === schoolOnlyError) throw new HttpsError('permission-denied', message)
    if (message && invoiceSubscriptionPreconditionErrors.has(message)) {
      throw new HttpsError('failed-precondition', message)
    }
    throw new HttpsError('unavailable', '請求書払いを開始できませんでした。時間をおいて再試行してください。')
  }
})

export const getBillingOverviewCallable = onCall(billingCallableOptions, async (request) => {
  const requestAuth = requireTeacherAuth(request)
  const data = requestRecord(request.data)
  if (typeof data.orgId !== 'string' || !data.orgId) {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  await requireBillingManager(data.orgId, requestAuth.uid)
  try {
    return await getBillingOverviewWithAdminSdk({ orgId: data.orgId })
  } catch (error) {
    const message = errorMessage(error)
    if (message === schoolOnlyError) throw new HttpsError('permission-denied', message)
    throw new HttpsError('unavailable', '請求情報を取得できませんでした。時間をおいて再試行してください。')
  }
})
