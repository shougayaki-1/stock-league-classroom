import { describe, expect, it } from 'vitest'
import type { LessonRunPrivateState, LessonRunPublicState, LessonRunTeamState } from './liveTypes'

describe('LessonRunPublicState / LessonRunPrivateState field separation', () => {
  it('LessonRunPublicState has no field named randomSeed or containing "seed"', () => {
    const publicKeys: (keyof LessonRunPublicState)[] = ['status', 'currentPhaseId', 'updatedAtMillis']
    expect(publicKeys.some((key) => key.toLowerCase().includes('seed'))).toBe(false)
  })
  it('LessonRunPrivateState carries randomSeed', () => {
    const privateKeys: (keyof LessonRunPrivateState)[] = ['randomSeed', 'restoreGeneration', 'updatedAtMillis']
    expect(privateKeys).toContain('randomSeed')
  })

  it('LessonRunPublicState carries per-stock price/breakdown but never a coefficient or seed', () => {
    const state: LessonRunPublicState = {
      status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1,
      orgId: 'personal_teacher-a', remainingPhaseSeconds: null, publicTask: null, notifications: [],
      marketPaused: false, nextBatchAtMillis: 1003000,
      stocks: {
        acme: {
          currentPrice: 1030, previousPrice: 1000, guardApplied: false, suddenChangeWarning: false,
          breakdown: { informationPercent: 2.1, demandPercent: 0.8, otherPercent: 0.1, total: 3.0 },
          displayedVolumeShares: 42,
        },
      },
    }
    expect(Object.keys(state)).not.toContain('randomSeed')
    expect(Object.keys(state.stocks.acme.breakdown)).toEqual(['informationPercent', 'demandPercent', 'otherPercent', 'total'])
  })

  it('LessonRunPrivateState carries a per-stock computationLog never sent to students', () => {
    const state: LessonRunPrivateState = {
      randomSeed: 'seed-1', restoreGeneration: 1, updatedAtMillis: 1, lastProcessedBatchId: 'batch-1',
      computationLog: {
        acme: { informationImpactPercent: 2.1, demandImpactPercent: 0.8, noisePercent: 0.1, priceSensitivityPreset: 'MEDIUM' },
      },
    }
    expect(state.computationLog.acme.priceSensitivityPreset).toBe('MEDIUM')
  })

  it('LessonRunTeamState is a type distinct from public/private state — its own visibility class', () => {
    const state: LessonRunTeamState = {
      cash: 14000, holdings: { acme: 3 }, lockedBuyValue: 6000, lockedSellQuantity: {},
      myOrders: [{ orderId: 'o1', stockId: 'acme', side: 'BUY', quantity: 5, status: 'PENDING', referencePrice: 1000 }],
      updatedAtMillis: 1,
    }
    expect(state.cash).toBe(14000)
  })
})
