import { getFirestore } from 'firebase-admin/firestore'
import { computeAvailableCash, computeAvailableShares } from '../../market/engine/fundLocking'
import type { TeamAccount } from './types'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
}
export interface FirestoreLike {
  runTransaction: (fn: (tx: FirestoreTx) => Promise<unknown>) => Promise<unknown>
}

const accountPath = (lessonRunId: string, teamId: string) => `lessonRuns/${lessonRunId}/teamAccounts/${teamId}`

export const getOrInitTeamAccount = async (input: {
  firestore: FirestoreLike; lessonRunId: string; teamId: string; startingCash: number; now: () => number
}): Promise<TeamAccount> => {
  return input.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(accountPath(input.lessonRunId, input.teamId))
    if (snap.exists) return snap.data() as unknown as TeamAccount
    const account: TeamAccount = {
      teamId: input.teamId, lessonRunId: input.lessonRunId, cash: input.startingCash,
      holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, updatedAtServerMillis: input.now(),
    }
    tx.set(accountPath(input.lessonRunId, input.teamId), account as unknown as Record<string, unknown>)
    return account
  }) as Promise<TeamAccount>
}

export interface ApplySoftLockInput {
  firestore: FirestoreLike
  lessonRunId: string
  teamId: string
  side: 'BUY' | 'SELL'
  stockId: string
  quantity: number
  referencePrice: number
  now: () => number
}
export type ApplySoftLockResult = { accepted: true } | { accepted: false; reason: string }

/** Spec §12.16: soft-locks at the reference price on submission. Rejection
 * here means the order is never created — "注文を受け付けない（UIで防ぐ）",
 * reinforced server-side as defense in depth. */
export const applySoftLockForNewOrder = async (input: ApplySoftLockInput): Promise<ApplySoftLockResult> => {
  return input.firestore.runTransaction(async (tx) => {
    const path = accountPath(input.lessonRunId, input.teamId)
    const snap = await tx.get(path)
    const account = snap.data() as unknown as TeamAccount
    if (input.side === 'BUY') {
      const available = computeAvailableCash(account.cash, account.lockedBuyValue)
      const cost = input.quantity * input.referencePrice
      if (cost > available) return { accepted: false, reason: '利用可能現金が不足しています。' }
      tx.set(path, { ...account, lockedBuyValue: account.lockedBuyValue + cost, updatedAtServerMillis: input.now() } as unknown as Record<string, unknown>)
      return { accepted: true }
    }
    const heldShares = account.holdings[input.stockId] ?? 0
    const lockedShares = account.lockedSellQuantity[input.stockId] ?? 0
    const available = computeAvailableShares(heldShares, lockedShares)
    if (input.quantity > available) return { accepted: false, reason: '売却可能株数が不足しています。' }
    tx.set(path, {
      ...account,
      lockedSellQuantity: { ...account.lockedSellQuantity, [input.stockId]: lockedShares + input.quantity },
      updatedAtServerMillis: input.now(),
    } as unknown as Record<string, unknown>)
    return { accepted: true }
  }) as Promise<ApplySoftLockResult>
}

export interface ReleaseSoftLockInput {
  firestore: FirestoreLike
  lessonRunId: string
  teamId: string
  side: 'BUY' | 'SELL'
  stockId: string
  quantity: number
  referencePrice: number
  now: () => number
}

/** Inverse of applySoftLockForNewOrder — used on cancel (Task 8) and after
 * hard settlement replaces the soft lock with the real outcome (Task 9). */
export const releaseSoftLock = async (input: ReleaseSoftLockInput): Promise<void> => {
  await input.firestore.runTransaction(async (tx) => {
    const path = accountPath(input.lessonRunId, input.teamId)
    const snap = await tx.get(path)
    const account = snap.data() as unknown as TeamAccount
    if (input.side === 'BUY') {
      tx.set(path, {
        ...account,
        lockedBuyValue: account.lockedBuyValue - input.quantity * input.referencePrice,
        updatedAtServerMillis: input.now(),
      } as unknown as Record<string, unknown>)
      return
    }
    const currentLocked = account.lockedSellQuantity[input.stockId] ?? 0
    tx.set(path, {
      ...account,
      lockedSellQuantity: { ...account.lockedSellQuantity, [input.stockId]: currentLocked - input.quantity },
      updatedAtServerMillis: input.now(),
    } as unknown as Record<string, unknown>)
  })
}

/**
 * Server-internal only: no Callable wraps this directly. `submitOrder`'s
 * onCall.ts calls these after resolving/authorizing the caller's teamId,
 * same shape as `ordersRepositoryWithAdminSdk`.
 */
export const teamAccountsRepositoryWithAdminSdk = (): FirestoreLike => {
  const db = getFirestore()
  return {
    runTransaction: (fn) => db.runTransaction((tx) => fn({
      get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path, data) => { tx.set(db.doc(path), data) },
    })),
  }
}
