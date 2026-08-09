import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { createStripeCheckoutSessionCallable } from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createStripeCheckoutSessionWithAdminSdk } from './stripeCheckout'
vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./stripeCheckout', async (importOriginal) => ({ ...(await importOriginal<typeof import('./stripeCheckout')>()), createStripeCheckoutSessionWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }))
const auth = { uid: 'u', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']; const request = { auth, data: { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' } } as unknown as CallableRequest
describe('createStripeCheckoutSessionCallable', () => { beforeEach(() => vi.clearAllMocks()); it('rejects a non-manager', async () => { vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 }); await expect(createStripeCheckoutSessionCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' }) }); it('creates checkout for an owner', async () => { vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 }); vi.mocked(createStripeCheckoutSessionWithAdminSdk).mockResolvedValueOnce({ url: 'https://checkout.stripe.com/x' }); await expect(createStripeCheckoutSessionCallable.run(request)).resolves.toEqual({ url: 'https://checkout.stripe.com/x' }) }) })
