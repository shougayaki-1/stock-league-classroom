import { describe, expect, it } from 'vitest'
import { parentContractStateFor, shouldApplySubscriptionState } from './subscriptionState'

describe('shouldApplySubscriptionState', () => {
  it('accepts the first observed subscription state and newer events only', () => {
    expect(shouldApplySubscriptionState(undefined, {
      subscriptionId: 'sub_1',
      status: 'active',
      eventCreatedAtMillis: 100,
    })).toBe(true)

    expect(shouldApplySubscriptionState(
      { subscriptionId: 'sub_1', status: 'active', eventCreatedAtMillis: 100 },
      { subscriptionId: 'sub_1', status: 'past_due', eventCreatedAtMillis: 100 },
    )).toBe(false)

    expect(shouldApplySubscriptionState(
      { subscriptionId: 'sub_1', status: 'canceled', eventCreatedAtMillis: 200 },
      { subscriptionId: 'sub_1', status: 'active', eventCreatedAtMillis: 199 },
    )).toBe(false)

    expect(shouldApplySubscriptionState(
      { subscriptionId: 'sub_1', status: 'canceled', eventCreatedAtMillis: 200 },
      { subscriptionId: 'sub_2', status: 'active', eventCreatedAtMillis: 201 },
    )).toBe(true)
  })
})

describe('parentContractStateFor', () => {
  it('ends a parent contract on canceled and reactivates it only for a newer active event', () => {
    expect(parentContractStateFor('parentOrg', 'canceled')).toBe('ENDED')
    expect(parentContractStateFor('parentOrg', 'active')).toBe('ACTIVE')
    expect(parentContractStateFor('parentOrg', 'past_due')).toBeUndefined()
    expect(parentContractStateFor('school', 'canceled')).toBeUndefined()
  })
})
