import { createHash } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { saveBillingProfile, validateBillingProfile, type BillingProfileInput } from './billingProfile'
import { stripeSecretKey } from './stripeCheckout'

export const saveBillingProfileWithAdminSdk = (
  input: { orgId: string; profile: BillingProfileInput; actorUid: string },
): Promise<{ stripeCustomerId: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  const organizationRef = db.doc(`organizations/${input.orgId}`)
  const profileRef = db.doc(`organizations/${input.orgId}/billingPrivate/profile`)
  const profile = validateBillingProfile(input.profile)
  const profileFingerprint = createHash('sha256').update(JSON.stringify(profile)).digest('hex')

  return db.runTransaction(async (tx) => {
    const [organization, privateProfile] = await Promise.all([
      tx.get(organizationRef),
      tx.get(profileRef),
    ])
    const organizationData = organization.exists ? organization.data() ?? null : null
    if (organizationData?.type !== 'school') throw new Error('請求書払いは学校組織のみ利用できます')
    const existingSaveRequest = privateProfile.exists
      ? privateProfile.data()?.saveRequest as Record<string, unknown> | undefined
      : undefined
    if (
      existingSaveRequest?.status === 'CREATING'
      && existingSaveRequest.profileFingerprint !== profileFingerprint
    ) throw new Error('請求先プロフィールの保存を処理中です')
    const operationId = existingSaveRequest?.status === 'CREATING'
      && typeof existingSaveRequest.operationId === 'string'
      ? existingSaveRequest.operationId
      : db.collection(`organizations/${input.orgId}/billingProfileOperations`).doc().id
    if (existingSaveRequest?.status !== 'CREATING') {
      tx.set(profileRef, {
        ...(privateProfile.exists ? privateProfile.data() : {}),
        saveRequest: {
          status: 'CREATING',
          operationId,
          profileFingerprint,
          requestedByUid: input.actorUid,
          requestedAt: FieldValue.serverTimestamp(),
        },
      })
    }
    return { organizationData, operationId }
  }).then(async ({ organizationData, operationId }) => saveBillingProfile({
    getOrganization: async () => organizationData,
    syncStripeCustomer: async ({ existingCustomerId, profile: normalizedProfile, idempotencyKey }) => {
      const customerData = {
        name: normalizedProfile.legalName,
        email: normalizedProfile.email,
        address: {
          postal_code: normalizedProfile.address.postalCode,
          state: normalizedProfile.address.prefecture,
          city: normalizedProfile.address.city,
          line1: normalizedProfile.address.line1,
          ...(normalizedProfile.address.line2 ? { line2: normalizedProfile.address.line2 } : {}),
          country: 'JP',
        },
      }
      return existingCustomerId
        ? stripe.customers.update(existingCustomerId, customerData, { idempotencyKey })
        : stripe.customers.create(customerData, { idempotencyKey })
    },
    saveBillingProfile: async (_orgId, data) => {
      await db.runTransaction(async (tx) => {
        const [organization, privateProfile] = await Promise.all([
          tx.get(organizationRef),
          tx.get(profileRef),
        ])
        const saveRequest = privateProfile.exists
          ? privateProfile.data()?.saveRequest as Record<string, unknown> | undefined
          : undefined
        if (
          !organization.exists
          || saveRequest?.status !== 'CREATING'
          || saveRequest.operationId !== operationId
          || saveRequest.profileFingerprint !== profileFingerprint
        ) throw new Error('請求先プロフィールの保存状態が変更されました')
        tx.update(organizationRef, {
          stripeCustomerId: data.stripeCustomerId,
          billingProfile: FieldValue.delete(),
        })
        tx.set(profileRef, { billingProfile: data.billingProfile })
        tx.set(db.doc(`stripeCustomers/${data.stripeCustomerId}`), { orgId: input.orgId })
      })
    },
    now: () => FieldValue.serverTimestamp(),
  }, { ...input, profile, updateOperationId: operationId }))
}
