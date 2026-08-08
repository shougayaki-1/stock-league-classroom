import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import {
  getHouseholdStateWithAdminSdk,
  householdRepositoryWithAdminSdk,
  saveHouseholdDecision,
} from '../lessonRuns/households/repository'
import { canControlLesson } from '../lessonRuns/authorization'
import { requireActiveOrgMember } from '../organizations/authorization'
import { submitHouseholdDecision } from './submitDecision'
import type { HouseholdDecisionInput } from './submitDecision'
import { processRoundWithAdminSdk } from './processRound'

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

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Plain finite-number-valued object, e.g. `{ DOMESTIC_STOCK: 100000 }` — not an array, not containing non-numeric/non-finite values. */
const isFiniteNumberMap = (value: unknown): value is Record<string, number> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'number' && Number.isFinite(entry))

const isNonEmptyStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isNonEmptyString)

/**
 * `shortfallResolutionType` is validated here as the already-normalized
 * (`?? null`) value — never the raw `data.shortfallResolutionType`, which
 * may be `undefined` and would otherwise flow un-normalized into
 * `requestDigest` (`lib/idempotency.ts`), whose `canonicalize` throws an
 * untranslated `TypeError` on `undefined`.
 */
const validateRequest = (
  data: SubmitHouseholdDecisionRequest,
  shortfallResolutionType: HouseholdDecisionInput['shortfallResolutionType'],
): void => {
  if (
    !data.lessonRunId || !data.householdId
    || typeof data.roundIndex !== 'number' || !Number.isInteger(data.roundIndex) || data.roundIndex < 0
    || !isFiniteNumberMap(data.assetAllocationChangesYen)
    || !isNonEmptyStringArray(data.insurancePurchaseIds)
    || !isNonEmptyStringArray(data.insuranceCancelIds)
    || !isNonEmptyStringArray(data.publicSupportApplicationIds)
    || !VALID_SHORTFALL_TYPES.has(shortfallResolutionType)
    // §13.13: SELL_ASSETS without naming the asset would silently bypass the
    // one cross-field consistency check `submitHouseholdDecision` performs.
    || (shortfallResolutionType === 'SELL_ASSETS' && !isNonEmptyString(data.shortfallResolutionAssetType))
    || !data.idempotencyKey
  ) {
    throw new HttpsError(
      'invalid-argument',
      'lessonRunId、householdId、roundIndex、assetAllocationChangesYen、insurancePurchaseIds、insuranceCancelIds、shortfallResolutionType、publicSupportApplicationIds、idempotencyKey は必須です。shortfallResolutionType が SELL_ASSETS の場合、shortfallResolutionAssetType も必須です。',
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
  // Normalized once here, forwarded everywhere downstream — never the raw
  // `data.shortfallResolutionType`, which may be `undefined` (see
  // `validateRequest`'s doc comment).
  const shortfallResolutionType = data.shortfallResolutionType ?? null
  validateRequest(data, shortfallResolutionType)

  const actorParticipantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)

  const household = await getHouseholdStateWithAdminSdk(data.lessonRunId, data.householdId)
  if (!household) throw new HttpsError('not-found', '対象の家庭の状態が見つかりません。')

  await requireTeamMembership(data.lessonRunId, household.teamId, actorParticipantId)

  // The household doc is already in scope from authorization above — its
  // own `roundIndex` is the source of truth for which round a student may
  // submit a decision for, so this check is free and closes off submitting
  // for a round far from where the household actually is.
  if (data.roundIndex !== household.roundIndex) {
    throw new HttpsError('failed-precondition', 'この家庭は現在別のラウンドです。roundIndex が一致しません。')
  }

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
      shortfallResolutionType,
      ...(data.shortfallResolutionAssetType !== undefined ? { shortfallResolutionAssetType: data.shortfallResolutionAssetType } : {}),
      publicSupportApplicationIds: data.publicSupportApplicationIds,
      idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateSubmitHouseholdDecisionError(error)
  }
})

interface ProcessRoundRequest {
  lessonRunId: string
  householdId: string
}

/**
 * Translates `processRound`'s bare Error messages into HttpsError codes at
 * the Callable boundary, matching every other task's pure/DI-layer
 * convention (`transitionPhaseCallable`'s `translateTransitionPhaseError`,
 * this file's own `translateSubmitHouseholdDecisionError`).
 */
const translateProcessRoundError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'HouseholdState not found') return new HttpsError('not-found', error.message)
    if (error.message === 'HouseholdProfile not found in template snapshot') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'LessonRun has no homeEconomics content') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/**
 * Teacher-facing round-settlement Callable — spec §13.7〜§13.13 (Task 11).
 * Classified PROCESS_ROUND, PRIMARY-only in `lessonRuns/authorization.ts`
 * (same "keep the lesson's overall progression at a single decision
 * point" reasoning `transitionPhaseCallable` uses for TRANSITION_PHASE —
 * see that file's doc comment). Authorization reads `teacherRoles` off the
 * `lessonRuns/{id}` document itself, exactly like `transitionPhaseCallable`
 * — the caller's role is NEVER trusted from client input.
 *
 * RTDB projections are intentionally NOT updated here — see
 * `processRound.ts`'s doc comment for why (deferred to Task 15).
 */
export const processRoundCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as ProcessRoundRequest
  if (!data.lessonRunId || !data.householdId) {
    throw new HttpsError('invalid-argument', 'lessonRunId、householdId は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role || !canControlLesson(role, 'PROCESS_ROUND')) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  try {
    return await processRoundWithAdminSdk({
      lessonRunId: data.lessonRunId,
      householdId: data.householdId,
      actorId: request.auth.uid,
    })
  } catch (error) {
    throw translateProcessRoundError(error)
  }
})
