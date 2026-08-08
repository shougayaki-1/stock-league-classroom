import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  getHouseholdStateWithAdminSdk,
  householdRepositoryWithAdminSdk,
  saveHouseholdDecision,
} from '../lessonRuns/households/repository'
import { submitHouseholdDecision } from './submitDecision'
import type { HouseholdDecisionInput } from './submitDecision'

/**
 * Resolves the caller's `participantId` on this lessonRun from the verified
 * auth uid, same `participantsByAuthUid/{authUid}` index used by
 * `lessonRuns/responses/onCall.ts` and `market/onCall.ts` — never trusted
 * from client input.
 */
const resolveActorParticipantId = async (lessonRunId: string, authUid: string): Promise<string> => {
  const db = getFirestore()
  const indexSnap = await db.doc(`lessonRuns/${lessonRunId}/participantsByAuthUid/${authUid}`).get()
  if (!indexSnap.exists) throw new HttpsError('failed-precondition', 'このレッスンランに参加していません。')
  const { participantId } = indexSnap.data() as { participantId: string }
  return participantId
}

/**
 * Verifies the caller is actually a member of `teamId` — same shape as
 * `market/onCall.ts`'s `requireTeamMembership`. Only called here with a
 * `teamId` resolved server-side from the `HouseholdState` document itself
 * (see `submitHouseholdDecisionCallable` below), never with a client-
 * supplied `teamId`.
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

interface SubmitHouseholdDecisionRequest {
  lessonRunId: string
  householdId: string
  roundIndex: number
  assetAllocationChangesYen: Record<string, number>
  insurancePurchaseIds: string[]
  insuranceCancelIds: string[]
  shortfallResolutionType: HouseholdDecisionInput['shortfallResolutionType']
  shortfallResolutionAssetType?: string
  publicSupportApplicationIds: string[]
  idempotencyKey: string
}

const VALID_SHORTFALL_TYPES = new Set(['REDUCE_EXPENSES', 'SELL_ASSETS', 'BORROW', 'PUBLIC_SUPPORT', 'DELAY_GOAL', null])

const validateRequest = (data: SubmitHouseholdDecisionRequest): void => {
  if (
    !data.lessonRunId || !data.householdId
    || typeof data.roundIndex !== 'number' || !Number.isInteger(data.roundIndex) || data.roundIndex < 0
    || typeof data.assetAllocationChangesYen !== 'object' || data.assetAllocationChangesYen === null
    || !Array.isArray(data.insurancePurchaseIds) || !Array.isArray(data.insuranceCancelIds)
    || !Array.isArray(data.publicSupportApplicationIds)
    || !VALID_SHORTFALL_TYPES.has(data.shortfallResolutionType ?? null)
    || !data.idempotencyKey
  ) {
    throw new HttpsError(
      'invalid-argument',
      'lessonRunId、householdId、roundIndex、assetAllocationChangesYen、insurancePurchaseIds、insuranceCancelIds、shortfallResolutionType、publicSupportApplicationIds、idempotencyKey は必須です。',
    )
  }
}

/**
 * Translates the pure/DI layer's bare Error messages into HttpsError codes
 * at the Callable boundary, matching every other task's convention
 * (`market/onCall.ts`'s `translateSubmitOrderError`,
 * `lessonRuns/responses/onCall.ts`'s `translateResponseError`).
 */
const translateSubmitHouseholdDecisionError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === '資金不足の解消に使う資産へ、同時に追加配分することはできません。') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/**
 * Student-facing bundled round-decision Callable — spec §13.4〜§13.9/§13.13
 * (Task 10). Authorization mirrors `cancelOrderCallable`
 * (`market/onCall.ts`): the client does not supply a `teamId` to authorize
 * against, because a client-supplied `teamId` would be exactly the kind of
 * ownership claim this repo's Task 10 brief warns never to trust. Instead
 * this Callable reads the `HouseholdState` document for the requested
 * `householdId` FIRST (server-side, read-only, outside any transaction)
 * and checks membership against ITS OWN stored `teamId` — so a caller
 * cannot spoof another team's household by supplying a different
 * `householdId` in the request; ownership is always resolved from
 * Firestore, never from client input.
 */
export const submitHouseholdDecisionCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as SubmitHouseholdDecisionRequest
  validateRequest(data)

  const actorParticipantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)

  const household = await getHouseholdStateWithAdminSdk(data.lessonRunId, data.householdId)
  if (!household) throw new HttpsError('not-found', '対象の家庭の状態が見つかりません。')

  await requireTeamMembership(data.lessonRunId, household.teamId, actorParticipantId)

  try {
    return await submitHouseholdDecision({
      saveDecision: (input) => saveHouseholdDecision({
        firestore: householdRepositoryWithAdminSdk(),
        lessonRunId: input.lessonRunId,
        householdId: input.householdId,
        roundIndex: input.roundIndex,
        assetAllocationChangesYen: input.assetAllocationChangesYen,
        insurancePurchaseIds: input.insurancePurchaseIds,
        insuranceCancelIds: input.insuranceCancelIds,
        shortfallResolutionType: input.shortfallResolutionType,
        ...(input.shortfallResolutionAssetType !== undefined ? { shortfallResolutionAssetType: input.shortfallResolutionAssetType } : {}),
        publicSupportApplicationIds: input.publicSupportApplicationIds,
        idempotencyKey: input.idempotencyKey,
        now: Date.now,
      }),
      lessonRunId: data.lessonRunId,
      householdId: data.householdId,
      roundIndex: data.roundIndex,
      assetAllocationChangesYen: data.assetAllocationChangesYen,
      insurancePurchaseIds: data.insurancePurchaseIds,
      insuranceCancelIds: data.insuranceCancelIds,
      shortfallResolutionType: data.shortfallResolutionType,
      ...(data.shortfallResolutionAssetType !== undefined ? { shortfallResolutionAssetType: data.shortfallResolutionAssetType } : {}),
      publicSupportApplicationIds: data.publicSupportApplicationIds,
      idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateSubmitHouseholdDecisionError(error)
  }
})
