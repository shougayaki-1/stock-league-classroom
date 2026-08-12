import type { ParentContractState } from '../organizations/parentContract'

export type StripeSubscriptionState = {
  subscriptionId: string
  status: string
  eventCreatedAtMillis: number
}

export const shouldApplySubscriptionState = (
  existing: StripeSubscriptionState | undefined,
  incoming: StripeSubscriptionState,
): boolean => !existing || incoming.eventCreatedAtMillis > existing.eventCreatedAtMillis

export const parentContractStateFor = (orgType: string | undefined, status: string): ParentContractState | undefined => {
  if (orgType !== 'parentOrg') return undefined
  if (status === 'canceled') return 'ENDED'
  if (status === 'active') return 'ACTIVE'
  return undefined
}
