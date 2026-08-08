import { describe, expect, it } from 'vitest'
import { settleBatch, type SettleBatchInput } from './engine/settleBatch'

describe('multi-batch replay determinism (spec §27.2 item 11 / 矛盾解消D)', () => {
  it('re-running the same sequence of batches with the same randomSeed+restoreGeneration reproduces identical prices and outcomes', () => {
    const runSequence = (): unknown[] => {
      let currentPrice = 1000
      const results: unknown[] = []
      for (let batchIndex = 0; batchIndex < 5; batchIndex += 1) {
        const input: SettleBatchInput = {
          lessonRunId: 'run-1', batchId: `run-1_batch_${batchIndex}`, batchIndex,
          randomSeed: 'replay-seed', restoreGeneration: 0,
          priceSensitivityPreset: 'BALANCED', noiseEnabled: true,
          stocks: [{
            stockId: 'acme', currentPrice, initialPrice: 1000,
            priceGuard: { type: 'ABSOLUTE', minimumPrice: 1 },
            effectiveMarketSize: 100000, demandSensitivity: 1, informationImpactPercent: 0,
          }],
          orders: [{ orderId: `o${batchIndex}`, teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 1, referencePrice: currentPrice }],
          teamAccounts: [{ teamId: 'team-a', cash: 1000000, holdings: {} }],
        }
        const result = settleBatch(input)
        currentPrice = result.stocks[0].nextPrice
        results.push(result)
      }
      return results
    }

    expect(runSequence()).toEqual(runSequence())
  })

  it('a DIFFERENT restoreGeneration produces a different sequence — replay after a checkpoint restore is not a silent no-op (矛盾解消E/D)', () => {
    const runWithGeneration = (restoreGeneration: number) => settleBatch({
      lessonRunId: 'run-1', batchId: 'run-1_batch_0', batchIndex: 0,
      randomSeed: 'replay-seed', restoreGeneration,
      priceSensitivityPreset: 'BALANCED', noiseEnabled: true,
      stocks: [{
        stockId: 'acme', currentPrice: 1000, initialPrice: 1000,
        priceGuard: { type: 'ABSOLUTE', minimumPrice: 1 },
        effectiveMarketSize: 100000, demandSensitivity: 1, informationImpactPercent: 0,
      }],
      orders: [], teamAccounts: [],
    })
    expect(runWithGeneration(0).stocks[0].nextPrice).not.toBe(runWithGeneration(1).stocks[0].nextPrice)
  })
})
