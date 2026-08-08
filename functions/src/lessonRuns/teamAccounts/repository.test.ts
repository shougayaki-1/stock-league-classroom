import { describe, expect, it } from 'vitest'
import { applySoftLockForNewOrder, getOrInitTeamAccount } from './repository'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<unknown>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('getOrInitTeamAccount', () => {
  it('initializes a new account with the starting cash and no holdings', async () => {
    const fake = makeFakeFirestore()
    const account = await getOrInitTeamAccount({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a', startingCash: 100000, now: () => 1,
    })
    expect(account).toMatchObject({ cash: 100000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {} })
  })
})

describe('applySoftLockForNewOrder', () => {
  it('accepts a buy order within available cash and increases lockedBuyValue', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 20000, holdings: {},
      lockedBuyValue: 6000, lockedSellQuantity: {}, updatedAtServerMillis: 0,
    })
    // available = 20,000 - 6,000 = 14,000 (spec §12.16 example) — a 5,000 order fits
    const result = await applySoftLockForNewOrder({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'BUY', stockId: 'acme', quantity: 5, referencePrice: 1000, now: () => 1,
    })
    expect(result).toEqual({ accepted: true })
    expect(fake.docs.get('lessonRuns/run-1/teamAccounts/team-a')).toMatchObject({ lockedBuyValue: 11000 })
  })

  it('rejects a buy order that would exceed available cash, without mutating the account', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 20000, holdings: {},
      lockedBuyValue: 6000, lockedSellQuantity: {}, updatedAtServerMillis: 0,
    })
    // available = 14,000 — a 20-share order at 1,000 = 20,000 exceeds it
    const result = await applySoftLockForNewOrder({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'BUY', stockId: 'acme', quantity: 20, referencePrice: 1000, now: () => 1,
    })
    expect(result).toEqual({ accepted: false, reason: '利用可能現金が不足しています。' })
    expect(fake.docs.get('lessonRuns/run-1/teamAccounts/team-a')).toMatchObject({ lockedBuyValue: 6000 })
  })

  it('rejects a sell order that would exceed available shares of that stock', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 0, holdings: { acme: 10 },
      lockedBuyValue: 0, lockedSellQuantity: { acme: 4 }, updatedAtServerMillis: 0,
    })
    // available = 10 - 4 = 6 (spec §12.16 example) — selling 7 exceeds it
    const result = await applySoftLockForNewOrder({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'SELL', stockId: 'acme', quantity: 7, referencePrice: 1000, now: () => 1,
    })
    expect(result).toEqual({ accepted: false, reason: '売却可能株数が不足しています。' })
  })
})
