import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { get, ref, set } from 'firebase/database'
import { deleteMarketCompletely, isDeleteRecommended } from './marketDeletion'

const projectId = 'market-deletion-test'
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'password' as const } }

describe('isDeleteRecommended', () => {
  const dayMs = 24 * 60 * 60 * 1000

  it('30日を過ぎていればtrueを返す', () => {
    const market = { createdAt: { toMillis: () => 1000 } }
    expect(isDeleteRecommended(market, 1000 + 30 * dayMs)).toBe(true)
  })

  it('30日未満ならfalseを返す（教師はこの状態でも削除を実行できる＝UI側の制御は別）', () => {
    const market = { createdAt: { toMillis: () => 1000 } }
    expect(isDeleteRecommended(market, 1000 + 10 * dayMs)).toBe(false)
  })
})

describe('deleteMarketCompletely', () => {
  let environment: RulesTestEnvironment

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId,
      firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
      database: { rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8') },
    })
  })
  afterAll(async () => environment.cleanup())
  beforeEach(async () => {
    await environment.clearFirestore()
    await environment.clearDatabase()
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'markets', 'm1'), {
        ownerUid: 'teacher-1', capacity: 80, visibility: 'private', templateSnapshot: {}, createdAt: new Date(),
      })
      await setDoc(doc(context.firestore(), 'marketResults', 'm1', 'participants', 'p1'), {
        ownerUid: 'teacher-1', participantId: 'p1', participantUid: 'student-1', checkpointId: 'c1',
        portfolio: { cash: 1000, holdings: {} }, transactions: {}, finalizedAtMillis: 1,
      })
      await setDoc(doc(context.firestore(), 'marketResults', 'm1', 'participants', 'p2'), {
        ownerUid: 'teacher-1', participantId: 'p2', participantUid: 'student-2', checkpointId: 'c1',
        portfolio: { cash: 500, holdings: {} }, transactions: {}, finalizedAtMillis: 1,
      })
      await set(ref(context.database(), 'liveMarkets/m1'), {
        meta: { ownerUid: 'teacher-1', capacity: 80, visibility: 'private', status: 'ENDED', createdAtMillis: 1, startingCash: 10000 },
      })
    })
  })

  it('30日未満でも教師の削除操作でFirestore結果・市場・RTDBライブデータを即座に削除する', async () => {
    const teacherApp = environment.authenticatedContext('teacher-1', teacherToken)

    await deleteMarketCompletely(teacherApp.firestore() as any, teacherApp.database() as any, 'm1')

    let marketExists = true
    let resultsEmpty = false
    let liveExists = true
    await environment.withSecurityRulesDisabled(async (ctx) => {
      marketExists = (await getDoc(doc(ctx.firestore(), 'markets', 'm1'))).exists()
      resultsEmpty = (await getDocs(collection(ctx.firestore(), 'marketResults', 'm1', 'participants'))).empty
      liveExists = (await get(ref(ctx.database(), 'liveMarkets/m1'))).exists()
    })
    expect(marketExists).toBe(false)
    expect(resultsEmpty).toBe(true)
    expect(liveExists).toBe(false)
  })

  it('市場の所有者ではない教師は削除できない', async () => {
    const otherTeacher = environment.authenticatedContext('teacher-2', teacherToken)

    await expect(deleteMarketCompletely(otherTeacher.firestore() as any, otherTeacher.database() as any, 'm1')).rejects.toThrow()

    let marketExists = false
    await environment.withSecurityRulesDisabled(async (ctx) => {
      marketExists = (await getDoc(doc(ctx.firestore(), 'markets', 'm1'))).exists()
    })
    expect(marketExists).toBe(true)
  })
})
