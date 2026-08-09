import { httpsCallable, type Functions } from 'firebase/functions'

export interface CreateStripeCustomerPortalSessionInput {
  orgId: string
  returnUrl: string
}

export interface CreateStripeCustomerPortalSessionResult {
  url: string
}

export const createStripeCustomerPortalSession = async (
  functions: Functions,
  input: CreateStripeCustomerPortalSessionInput,
): Promise<CreateStripeCustomerPortalSessionResult> =>
  (await httpsCallable<CreateStripeCustomerPortalSessionInput, CreateStripeCustomerPortalSessionResult>(
    functions,
    'createStripeCustomerPortalSessionCallable',
  )(input)).data
