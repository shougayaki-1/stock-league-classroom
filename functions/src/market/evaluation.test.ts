import { describe, expect, it } from 'vitest'
import { computeOperationResultScore, computePredictionAccuracyScore, computeWeightedTotalScore, rankByCriterion } from './evaluation'

describe('computeOperationResultScore', () => {
  it('scores a 10% return as a 10-point gain over the 100-point baseline (starting cash = 100)', () => {
    expect(computeOperationResultScore({ finalAssetValue: 110000, startingCash: 100000 })).toBeCloseTo(110, 9)
  })
})

describe('computePredictionAccuracyScore', () => {
  it('returns the percentage of resolved predictions that were correct', () => {
    expect(computePredictionAccuracyScore([{ outcome: 'CORRECT' }, { outcome: 'CORRECT' }, { outcome: 'INCORRECT' }])).toBeCloseTo(200 / 3, 6)
  })

  it('returns null (not zero) for a team that never submitted a resolved prediction (矛盾解消F)', () => {
    expect(computePredictionAccuracyScore([])).toBeNull()
  })
})

describe('computeWeightedTotalScore', () => {
  const weights = { operationResult: 0.1, predictionAccuracy: 0.3, informationUsage: 0.4, riskManagement: 0.1, reflection: 0.1 }

  it('combines all 5 scores when every one is present', () => {
    const total = computeWeightedTotalScore(
      { operationResult: 100, predictionAccuracy: 80, informationUsage: 90, riskManagement: 70, reflection: 60 },
      weights,
    )
    expect(total).toBeCloseTo(100 * 0.1 + 80 * 0.3 + 90 * 0.4 + 70 * 0.1 + 60 * 0.1, 9)
  })

  it('renormalizes the remaining weights when predictionAccuracy is null (team never predicted)', () => {
    const total = computeWeightedTotalScore(
      { operationResult: 100, predictionAccuracy: null, informationUsage: 90, riskManagement: 70, reflection: 60 },
      weights,
    )
    const remainingWeightSum = 0.1 + 0.4 + 0.1 + 0.1 // 0.7
    const expected = (100 * 0.1 + 90 * 0.4 + 70 * 0.1 + 60 * 0.1) / remainingWeightSum
    expect(total).toBeCloseTo(expected, 9)
  })
})

describe('rankByCriterion', () => {
  it('sorts teams descending by the given criterion, excluding teams with a null score for it', () => {
    const teams = [
      { teamId: 'a', predictionAccuracy: 80 },
      { teamId: 'b', predictionAccuracy: null },
      { teamId: 'c', predictionAccuracy: 95 },
    ]
    const ranked = rankByCriterion(teams, 'predictionAccuracy')
    expect(ranked.map((r) => r.teamId)).toEqual(['c', 'a'])
  })
})
