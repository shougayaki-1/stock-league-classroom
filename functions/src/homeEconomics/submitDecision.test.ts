import { describe, expect, it, vi } from 'vitest'
import { submitHouseholdDecision } from './submitDecision'

describe('submitHouseholdDecision', () => {
  it('is idempotent per (lessonRunId, householdId, roundIndex, idempotencyKey)', async () => {
    const saveDecision = vi.fn().mockResolvedValue({ decisionId: 'dec-1', created: true })
    const result1 = await submitHouseholdDecision({
      saveDecision, lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
      shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
    })
    expect(result1.created).toBe(true)
    expect(saveDecision).toHaveBeenCalledOnce()
  })

  it('rejects a decision that both sells an asset for the shortfall AND reallocates more into that same asset (spec §13.13 internal consistency)', async () => {
    await expect(submitHouseholdDecision({
      saveDecision: vi.fn(), lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: { DOMESTIC_STOCK: 50000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
      shortfallResolutionType: 'SELL_ASSETS', shortfallResolutionAssetType: 'DOMESTIC_STOCK',
      publicSupportApplicationIds: [], idempotencyKey: 'key-2',
    })).rejects.toThrow('資金不足の解消に使う資産へ、同時に追加配分することはできません。')
  })
})
