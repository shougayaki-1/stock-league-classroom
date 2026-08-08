import { deriveSeed, mulberry32 } from '@stock-league/deterministic-random'
import type { AssetType } from '@stock-league/household-public-content'

export interface AssetReturnInput {
  assetType: AssetType
  valueYen: number
  /** Hidden from students (Task 1) — the teacher-authored base expectation. */
  expectedReturnPercent: number
  /** Hidden from students (Task 1) — drives the noise term's magnitude. */
  volatilityPercent: number
  /** Spec §13.11 — HomeEconomicsContent.economicFactors.marketReturnPercent (Task 2), added to expectedReturnPercent as the economic-environment adjustment. */
  marketReturnPercent: number
  householdId: string
  roundIndex: number
  randomSeed: string
  restoreGeneration: number
}
export interface AssetReturnResult {
  returnPercent: number
  nextValueYen: number
}

/**
 * Spec §13.5/§13.15: each asset's next value = current value × (1 +
 * expectedReturn + marketReturn + noise). Noise is deterministic PRNG,
 * scaled by volatilityPercent — an asset with 0 volatility (e.g. CASH)
 * gets exactly 0 noise, never an approximately-zero draw. Never goes
 * negative — a household's asset value floors at 0 (assets don't go
 * short in this simulation).
 */
export const computeAssetReturn = (input: AssetReturnInput): AssetReturnResult => {
  let noisePercent = 0
  if (input.volatilityPercent !== 0) {
    // Same seed schema as Phase C's calculateNextPrice
    // (functions/src/market/engine/priceCalculation.ts):
    // deriveSeed([randomSeed, restoreGeneration, <entity id>, <round key>]).
    // Here the entity is the household's position in a given asset type,
    // and the round key is roundIndex (a year, not a 3-second batch).
    const seed = deriveSeed([input.randomSeed, input.restoreGeneration, input.householdId, input.assetType, input.roundIndex])
    const rand = mulberry32(seed)()
    // rand is in [0, 1) — map to [-volatilityPercent, +volatilityPercent]
    noisePercent = (rand * 2 - 1) * input.volatilityPercent
  }
  const returnPercent = input.expectedReturnPercent + input.marketReturnPercent + noisePercent
  const nextValueYen = Math.max(0, Math.round(input.valueYen * (1 + returnPercent / 100)))
  return { returnPercent, nextValueYen }
}
