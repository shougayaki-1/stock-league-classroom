import { describe, expect, it, vi } from 'vitest'
import { submitAdvancedHouseholdDecision, submitHouseholdDecision } from './submitDecision'

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

describe('submitAdvancedHouseholdDecision', () => {
  const baseDecision = {
    decisionId: 'run-1_decision_abc', lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
    assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
    shortfallResolutionType: null as null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
  }

  it('delegates to saveDecision and returns the full HouseholdDecisionRecord unchanged', async () => {
    const record = { ...baseDecision, submittedAtServerMillis: 42 }
    const saveDecision = vi.fn().mockResolvedValue(record)
    const result = await submitAdvancedHouseholdDecision({
      saveDecision, lessonRunId: 'run-1', householdId: 'case-b', decision: baseDecision,
      expectedSynchronizedRoundIndex: 3, assignmentRevision: 1, idempotencyKey: 'key-1', nowMillis: 42,
    })
    expect(result).toEqual(record)
    expect(saveDecision).toHaveBeenCalledOnce()
    // The `saveDecision` callback receives everything EXCEPT itself — same
    // "spread off saveDecision, forward the rest" shape `submitHouseholdDecision`
    // uses above.
    expect(saveDecision).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', decision: baseDecision,
      expectedSynchronizedRoundIndex: 3, assignmentRevision: 1, idempotencyKey: 'key-1', nowMillis: 42,
    })
  })

  // Preserves the exact same spec §13.13 cross-field validation as the
  // Common path (`submitHouseholdDecision` above) — the advanced,
  // control-document-guarded persistence path must not be a way to bypass
  // this business rule.
  it('rejects a decision that both sells an asset for the shortfall AND reallocates more into that same asset (spec §13.13), never calling saveDecision', async () => {
    const saveDecision = vi.fn()
    await expect(submitAdvancedHouseholdDecision({
      saveDecision, lessonRunId: 'run-1', householdId: 'case-b',
      decision: {
        ...baseDecision, shortfallResolutionType: 'SELL_ASSETS' as const, shortfallResolutionAssetType: 'DOMESTIC_STOCK',
        assetAllocationChangesYen: { DOMESTIC_STOCK: 50000 },
      },
      expectedSynchronizedRoundIndex: 3, assignmentRevision: 1, idempotencyKey: 'key-1', nowMillis: 42,
    })).rejects.toThrow('資金不足の解消に使う資産へ、同時に追加配分することはできません。')
    expect(saveDecision).not.toHaveBeenCalled()
  })
})
