import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc } from 'firebase/firestore'
import { get, onValue, ref } from 'firebase/database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { acquireHostLease, openMarket, requestMarketEnding, runHostTick, submitOrder } from '../src/lib/market/hostTrading'
import { approveJoinRequest, createMarket, requestToJoinMarket } from '../src/lib/market/marketRepository'
import type { TemplateSpec } from '../src/lib/templates/types'

const projectId = 'classroom-flow-test'
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }
const template: TemplateSpec = {
  title: '結合テスト市場', description: '', startingCash: 1000,
  teams: [{ id: 'red', name: '赤' }, { id: 'blue', name: '青' }],
  companies: [{
    id: 'acme', name: 'Acme', symbol: 'ACME', initialPrice: 100,
    pricePhases: [{ id: 'flat', startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }],
  }],
}

describe('classroom release flow', () => {
  let environment: RulesTestEnvironment
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId,
      firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
      database: { rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8') },
    })
  })
  afterAll(async () => environment.cleanup())

  it('creates, joins, trades with a shared team account, and finalizes results', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken)
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } })
    const teacherFirestore = teacher.firestore() as never
    const teacherDatabase = teacher.database() as never
    const studentFirestore = student.firestore() as never
    const studentDatabase = student.database() as never
    const created = await createMarket(teacherFirestore, teacherDatabase, { ownerUid: 'teacher-a', template, visibility: 'private', joinCode: 'FLOW23' })
    let rootReady = false
    const stopRoot = onValue(ref(teacherDatabase, `liveMarkets/${created.marketId}`), (snapshot) => { rootReady = snapshot.exists() })
    await new Promise<void>((resolve) => {
      const stopReady = onValue(ref(teacherDatabase, `liveMarkets/${created.marketId}`), (snapshot) => {
        if (snapshot.exists()) { stopReady(); resolve() }
      })
    })
    expect(rootReady).toBe(true)
    const requestId = await requestToJoinMarket(studentDatabase, created.marketId, { uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null })
    expect(await approveJoinRequest(teacherDatabase, created.marketId, requestId, 'manual', 'red')).toBe(true)

    const leaseId = 'lease-flow'
    expect(await acquireHostLease(teacherDatabase, created.marketId, 'teacher-a', leaseId)).toBe(true)
    expect((await openMarket(teacherDatabase, created.marketId, 'teacher-a', leaseId)).committed).toBe(true)
    await runHostTick(teacherFirestore, teacherDatabase, created.marketId, 'teacher-a', leaseId, [{ id: 'acme', basePrice: 100, phases: template.companies[0].pricePhases }])

    expect((await submitOrder(studentDatabase, created.marketId, requestId, { orderId: 'order-1', stockId: 'acme', side: 'BUY', quantity: 3, submittedAtMillis: Date.now() })).committed).toBe(true)
    await runHostTick(teacherFirestore, teacherDatabase, created.marketId, 'teacher-a', leaseId, [{ id: 'acme', basePrice: 100, phases: template.companies[0].pricePhases }])
    const portfolio = (await get(ref(studentDatabase, `liveMarkets/${created.marketId}/teamPortfolios/red`))).val()
    expect(portfolio.cash).toBe(700)
    expect(portfolio.holdings.acme).toBe(3)

    expect((await requestMarketEnding(teacherDatabase, created.marketId, 'teacher-a', leaseId)).committed).toBe(true)
    await runHostTick(teacherFirestore, teacherDatabase, created.marketId, 'teacher-a', leaseId, [{ id: 'acme', basePrice: 100, phases: template.companies[0].pricePhases }])
    const result = await getDoc(doc(studentFirestore, 'marketResults', created.marketId, 'participants', requestId))
    expect(result.data()?.teamResult.rank).toBe(1)
    expect(result.data()?.transactions['order-1'].filledQuantity).toBe(3)

    expect((await openMarket(teacherDatabase, created.marketId, 'teacher-a', leaseId)).committed).toBe(true)
    await runHostTick(teacherFirestore, teacherDatabase, created.marketId, 'teacher-a', leaseId, [{ id: 'acme', basePrice: 100, phases: template.companies[0].pricePhases }])
    const reopened = (await get(ref(teacherDatabase, `liveMarkets/${created.marketId}`))).val()
    expect(reopened.meta.status).toBe('OPEN')
    expect(reopened.finalization).toBeUndefined()
    expect(reopened.signage.phase).toBe('OPEN')
    stopRoot()
  }, 20_000)

  // A teacher always takes the host lease while the market is still SETUP (waiting for
  // students to join) — that's the only way to reach the "開始" button at all. runHostTick
  // must tolerate that, not just OPEN/PAUSED/ENDING/ENDED. Mirrors ControlRoom.tsx, which
  // keeps an onValue listener open on the market root for as long as the page is mounted —
  // a transaction issued without any live listener sees a cold local cache on its first
  // (optimistic) pass, which is a separate, real quirk but not the one this test targets.
  it('keeps the host lease alive while the market is still SETUP', async () => {
    const teacher = environment.authenticatedContext('teacher-b', teacherToken)
    const teacherFirestore = teacher.firestore() as never
    const teacherDatabase = teacher.database() as never
    const created = await createMarket(teacherFirestore, teacherDatabase, { ownerUid: 'teacher-b', template, visibility: 'private', joinCode: 'SETUP1' })
    const stopLive = onValue(ref(teacherDatabase, `liveMarkets/${created.marketId}`), () => {})
    await new Promise<void>((resolve) => {
      const stop = onValue(ref(teacherDatabase, `liveMarkets/${created.marketId}`), (snapshot) => { if (snapshot.exists()) { stop(); resolve() } })
    })
    const leaseId = 'lease-setup'
    expect(await acquireHostLease(teacherDatabase, created.marketId, 'teacher-b', leaseId)).toBe(true)
    const tickOk = await runHostTick(teacherFirestore, teacherDatabase, created.marketId, 'teacher-b', leaseId, [])
    expect(tickOk).toBe(true)
    const state = (await get(ref(teacherDatabase, `liveMarkets/${created.marketId}`))).val()
    expect(state.meta.status).toBe('SETUP')
    expect(state.hostLease.leaseId).toBe(leaseId)
    stopLive()
  }, 20_000)
})
