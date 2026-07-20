import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { get, onValue, ref, set } from 'firebase/database'
import { writeSignageData } from './signageWriter'

/**
 * RTDB transactions run their update function against the locally synced cache, which is not
 * guaranteed to be populated immediately after a plain get()/set(). Attaching a live listener and
 * waiting for its first non-null value warms that cache so the transaction sees real data on its
 * first invocation, mirroring how a host client (which already holds an active listener on the
 * market) behaves in production. The listener is intentionally left attached: detaching it tears
 * down the SDK's synced cache for that path again before the transaction runs.
 */
const warmCache = (db: any, path: string) =>
  new Promise<void>((resolve) => {
    onValue(ref(db, path), (snap) => { if (snap.val()) resolve() })
  })

describe('writeSignageData', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'signage-writer-test',
      database: { host: 'localhost', port: 9000, rules: '{"rules": {".read": true, ".write": true}}' },
    })
  })
  afterAll(async () => testEnv.cleanup())
  beforeEach(async () => testEnv.clearDatabase())

  it('現在のホストリース保持者がsignageノードに整形済みデータを書き込む', async () => {
    const db = testEnv.unauthenticatedContext().database() as any
    await set(ref(db, 'liveMarkets/m1'), {
      meta: { ownerUid: 'teacher-1', status: 'OPEN' },
      hostLease: { ownerUid: 'teacher-1', leaseId: 'lease-1', expiresAtMillis: Date.now() + 60_000, paused: false },
    })
    await warmCache(db, 'liveMarkets/m1')
    const committed = await writeSignageData(db, 'm1', 'teacher-1', 'lease-1', {
      prices: [{ stockId: 's1', stockName: '開成テック', price: 1500 }],
      publicNews: ['本日の市場が開場しました。'],
      phase: 'OPEN',
      leaderboard: [{ name: 'たろう', valuation: 1_200_000 }],
    })
    expect(committed).toBe(true)
    const snap = await get(ref(db, 'liveMarkets/m1/signage'))
    expect(snap.val().prices[0].stockName).toBe('開成テック')
    expect(snap.val().phase).toBe('OPEN')
  })

  it('リースを保持していない場合は書き込まない', async () => {
    const db = testEnv.unauthenticatedContext().database() as any
    await set(ref(db, 'liveMarkets/m2'), {
      meta: { ownerUid: 'teacher-1', status: 'OPEN' },
      hostLease: { ownerUid: 'teacher-1', leaseId: 'old-lease', expiresAtMillis: Date.now() + 60_000, paused: false },
    })
    await warmCache(db, 'liveMarkets/m2')
    const committed = await writeSignageData(db, 'm2', 'teacher-1', 'stale-lease', {
      prices: [], publicNews: [], phase: 'OPEN', leaderboard: [],
    })
    expect(committed).toBe(false)
    const snap = await get(ref(db, 'liveMarkets/m2/signage'))
    expect(snap.exists()).toBe(false)
  })
})
