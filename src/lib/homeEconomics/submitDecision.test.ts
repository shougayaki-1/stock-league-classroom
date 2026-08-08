import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as market/submitOrder.test.ts: `httpsCallable`
// reaches into the real Functions instance's internals, so a plain fake
// `functions` object throws at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { submitHouseholdDecision } = await import('./submitDecision')

describe('submitHouseholdDecision (client)', () => {
  it('calls submitHouseholdDecisionCallable with the given fields, never sending a teamId', async () => {
    callable.mockResolvedValue({ data: { decisionId: 'dec-1', created: true } })
    const functions = {} as Functions

    const result = await submitHouseholdDecision(functions, {
      lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
      shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'idem-1',
    })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'submitHouseholdDecisionCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
      shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'idem-1',
    })
    expect(result).toEqual({ decisionId: 'dec-1', created: true })
  })

  it('forwards the optional shortfallResolutionAssetType when provided', async () => {
    callable.mockResolvedValue({ data: { decisionId: 'dec-2', created: false } })
    const functions = {} as Functions

    await submitHouseholdDecision(functions, {
      lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [],
      shortfallResolutionType: 'SELL_ASSETS', shortfallResolutionAssetType: 'DOMESTIC_STOCK',
      publicSupportApplicationIds: [], idempotencyKey: 'idem-2',
    })

    expect(callable).toHaveBeenCalledWith(expect.objectContaining({ shortfallResolutionAssetType: 'DOMESTIC_STOCK' }))
  })
})
