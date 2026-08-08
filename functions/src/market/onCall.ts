import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { createPendingOrder, ordersRepositoryWithAdminSdk } from '../lessonRuns/orders/repository'
import { applySoftLockForNewOrder, getOrInitTeamAccount, teamAccountsRepositoryWithAdminSdk } from '../lessonRuns/teamAccounts/repository'
import { submitOrder } from './submitOrder'

/**
 * Placeholder starting cash until a per-lessonRun/market-content field for
 * it exists (`SocialStudiesMarketContent` — `market-authoring-content`
 * package — has no such field yet). `getOrInitTeamAccount` only uses this
 * on the very first order a team ever submits; a future task that adds the
 * field can thread it through here without changing this Callable's
 * public contract.
 */
const DEFAULT_STARTING_CASH = 1_000_000

/**
 * Resolves the caller's `participantId` on this lessonRun from the verified
 * auth uid, same `participantsByAuthUid/{authUid}` index used by
 * `lessonRuns/responses/onCall.ts`'s `resolveActorParticipantId` — never
 * trusted from client input.
 */
const resolveActorParticipantId = async (lessonRunId: string, authUid: string): Promise<string> => {
  const db = getFirestore()
  const indexSnap = await db.doc(`lessonRuns/${lessonRunId}/participantsByAuthUid/${authUid}`).get()
  if (!indexSnap.exists) throw new HttpsError('failed-precondition', 'このレッスンランに参加していません。')
  const { participantId } = indexSnap.data() as { participantId: string }
  return participantId
}

/**
 * Verifies the caller is actually a member of the requested teamId before
 * any order is placed on that team's behalf — same shape as
 * `resolveResponseScope`'s teamId branch (`lessonRuns/responses/saveResponse.ts`).
 * A student cannot spoof another team's teamId: membership is checked
 * against the team's own Firestore document, not trusted from the request.
 */
const requireTeamMembership = async (lessonRunId: string, teamId: string, actorParticipantId: string): Promise<void> => {
  const db = getFirestore()
  const teamSnap = await db.doc(`lessonRuns/${lessonRunId}/teams/${teamId}`).get()
  if (!teamSnap.exists) throw new HttpsError('not-found', 'チームが見つかりません。')
  const team = teamSnap.data() as { memberParticipantIds: string[] }
  if (!team.memberParticipantIds.includes(actorParticipantId)) {
    throw new HttpsError('permission-denied', 'このチームのメンバーではありません。')
  }
}

/**
 * Admin SDK implementation of `SubmitOrderDeps['isMarketAcceptingOrders']`
 * (spec §12.25). `marketPaused` does not exist on `LessonRun` yet (added by
 * Task 11's pause/resume Callable) — its absence must read as "not paused",
 * hence `marketPaused !== true` rather than a truthiness check.
 */
const isMarketAcceptingOrdersWithAdminSdk = async (lessonRunId: string): Promise<boolean> => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  if (!snap.exists) return false
  const data = snap.data() as { status?: string; marketPaused?: boolean }
  return data.status === 'RUNNING' && data.marketPaused !== true
}

interface SubmitOrderRequest {
  lessonRunId: string
  batchId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  idempotencyKey: string
}

/**
 * Translates submitOrder's/applySoftLockForNewOrder's bare Error messages
 * into HttpsError codes at the Callable boundary, matching every other
 * task's pure-layer convention.
 */
const translateSubmitOrderError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === '市場は停止中です。新規注文は受け付けられません。') return new HttpsError('failed-precondition', error.message)
    if (error.message === '利用可能現金が不足しています。') return new HttpsError('failed-precondition', error.message)
    if (error.message === '売却可能株数が不足しています。') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/** Student-facing order submission Callable — spec §12.13/§12.16/§12.25. */
export const submitOrderCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as SubmitOrderRequest
  if (
    !data.lessonRunId || !data.batchId || !data.teamId || !data.stockId
    || (data.side !== 'BUY' && data.side !== 'SELL')
    || !data.quantity || data.quantity <= 0
    || !data.referencePrice || data.referencePrice <= 0
    || !data.idempotencyKey
  ) {
    throw new HttpsError('invalid-argument', 'lessonRunId、batchId、teamId、stockId、side、quantity、referencePrice、idempotencyKey は必須です。')
  }

  const actorParticipantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  await requireTeamMembership(data.lessonRunId, data.teamId, actorParticipantId)

  // Ensures the team's ledger exists before the soft lock reads it —
  // no-op if it was already initialized by an earlier order.
  await getOrInitTeamAccount({
    firestore: teamAccountsRepositoryWithAdminSdk(), lessonRunId: data.lessonRunId,
    teamId: data.teamId, startingCash: DEFAULT_STARTING_CASH, now: Date.now,
  })

  // Read once up front (submitOrder's isMarketAcceptingOrders is
  // synchronous by design, so it can be trivially faked in submitOrder's
  // own unit tests) rather than threading an async check through the DI.
  const marketAcceptingOrders = await isMarketAcceptingOrdersWithAdminSdk(data.lessonRunId)

  try {
    return await submitOrder({
      isMarketAcceptingOrders: () => marketAcceptingOrders,
      applySoftLock: (input) => applySoftLockForNewOrder({
        firestore: teamAccountsRepositoryWithAdminSdk(),
        lessonRunId: input.lessonRunId, teamId: input.teamId, side: input.side,
        stockId: input.stockId, quantity: input.quantity, referencePrice: input.referencePrice, now: Date.now,
      }),
      createOrder: (input) => createPendingOrder({
        firestore: ordersRepositoryWithAdminSdk(), lessonRunId: input.lessonRunId, batchId: input.batchId,
        teamId: input.teamId, participantId: actorParticipantId, stockId: input.stockId, side: input.side,
        quantity: input.quantity, referencePrice: input.referencePrice, idempotencyKey: input.idempotencyKey, now: Date.now,
      }),
      lessonRunId: data.lessonRunId, batchId: data.batchId, teamId: data.teamId, stockId: data.stockId,
      side: data.side, quantity: data.quantity, referencePrice: data.referencePrice, idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateSubmitOrderError(error)
  }
})
