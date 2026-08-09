import { httpsCallable, type Functions } from 'firebase/functions'
export interface CreateStripeCheckoutSessionInput { orgId: string; planId: string; successUrl: string; cancelUrl: string }
export const createStripeCheckoutSession = async (functions: Functions, input: CreateStripeCheckoutSessionInput): Promise<{ url: string }> => (await httpsCallable<CreateStripeCheckoutSessionInput, { url: string }>(functions, 'createStripeCheckoutSessionCallable')(input)).data
