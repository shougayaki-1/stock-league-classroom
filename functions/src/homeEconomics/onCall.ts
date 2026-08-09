import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import {
  getHouseholdStateWithAdminSdk,
  getOrInitHouseholdState,
  householdRepositoryWithAdminSdk,
  saveHouseholdDecision,
} from '../lessonRuns/households/repository'
import type { HouseholdState } from '../lessonRuns/households/repository'
import { canControlLesson } from '../lessonRuns/authorization'
import { requireActiveOrgMember } from '../organizations/authorization'
import { restoreCheckpointWithAdminSdk, writeCheckpointWithAdminSdk } from '../lessonRuns/checkpoint'
import { submitHouseholdDecision } from './submitDecision'
import type { HouseholdDecisionInput } from './submitDecision'
import { processRoundWithAdminSdk } from './processRound'
import { buildHouseholdCheckpointSnapshot, restoreHouseholdsFromSnapshot } from './checkpointRestore'
import type { HouseholdCheckpointSnapshot } from './checkpointRestore'

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

/**
 * Critical Fix #1 (final whole-branch review): `getOrInitHouseholdState`
 * (Task 10, households/repository.ts) had ZERO production callers — no
 * household document was ever created through normal lesson-run flow. This
 * lazily creates the caller's own household document the FIRST time they
 * submit a decision for it, rather than requiring a separate seeding step.
 *
 * Scoped deliberately to the COMMON_CONDITIONS course format —
 * `templateValidation.ts`'s `validateHomeEconomicsContent` is the only
 * place in this codebase that guarantees a `HomeEconomicsContent` has
 * exactly one `HouseholdProfile`, which is what makes "which profile does
 * this new household start from" unambiguous without a team→profile
 * assignment mechanism. ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM
 * (multiple profiles per template) are NOT supported by this lazy-init path
 * — see task-critical-fix-report.md for why that is a deliberate, documented
 * follow-up rather than a silent gap.
 *
 * `householdId` doubles as `teamId` under this scope: since there is only
 * one profile, every team's household is simply keyed by that team's own
 * `teamId` — no separate team→householdId assignment table is needed. This
 * also makes authorization trivial and safe: `requireTeamMembership` is
 * called FIRST, using the requested `householdId` itself as the `teamId` to
 * check. That confirms BOTH that a real team with this id exists in this
 * lessonRun AND that the caller is one of its members, before any household
 * document is created — a caller can never conjure a household for an
 * arbitrary or nonexistent team id, or for a team they do not belong to.
 */
const lazyInitHouseholdWithAdminSdk = async (
  lessonRunId: string,
  householdId: string,
  actorParticipantId: string,
): Promise<HouseholdState> => {
  await requireTeamMembership(lessonRunId, householdId, actorParticipantId)

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', '対象の家庭の状態が見つかりません。')
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  const homeEconomics = templateSnapshot?.homeEconomics
  if (!homeEconomics || homeEconomics.courseFormat !== 'COMMON_CONDITIONS' || homeEconomics.households.length !== 1) {
    throw new HttpsError(
      'failed-precondition',
      'このコース形式では家庭の自動初期化に対応していません（共通条件モードでプロフィールが1件の教材のみ対応）。',
    )
  }
  const profile = homeEconomics.households[0]

  return getOrInitHouseholdState({
    firestore: householdRepositoryWithAdminSdk(),
    lessonRunId,
    teamId: householdId,
    householdId,
    startingCashYen: profile.cashSavingsYen,
    startingLifeStage: profile.lifeStage,
    now: Date.now,
  })
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
  /** Spec §13.14 — see `HouseholdDecisionInput`'s own doc comment (`submitDecision.ts`). Optional; omitted or 0 means "no drawdown requested". */
  voluntaryDrawdownRequestedYen?: number
}

const VALID_SHORTFALL_TYPES = new Set(['REDUCE_EXPENSES', 'SELL_ASSETS', 'BORROW', 'PUBLIC_SUPPORT', 'DELAY_GOAL', null])

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Plain finite-number-valued object, e.g. `{ DOMESTIC_STOCK: 100000 }` — not an array, not containing non-numeric/non-finite values. */
const isFiniteNumberMap = (value: unknown): value is Record<string, number> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'number' && Number.isFinite(entry))

const isNonEmptyStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isNonEmptyString)

/**
 * Optional non-negative INTEGER-yen number — `undefined` (field omitted) is
 * valid; a present value must not be negative/NaN/Infinity/fractional.
 * Fractional yen is rejected here (not just clamped) because
 * `computeVoluntaryAssetDrawdown` (`engine/retirement.ts`) debits whole-yen
 * amounts per remainder step against the requested amount — a fractional
 * request like `100.5` would leave 0.5 yen unaccounted for, silently
 * destroying money that every other path in this engine treats as integer
 * yen (see `HouseholdState.cashYen`).
 */
const isValidOptionalNonNegativeNumber = (value: unknown): boolean =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0)

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
    || !isValidOptionalNonNegativeNumber(data.voluntaryDrawdownRequestedYen)
  ) {
    throw new HttpsError(
      'invalid-argument',
      'lessonRunId、householdId、roundIndex、assetAllocationChangesYen、insurancePurchaseIds、insuranceCancelIds、shortfallResolutionType、publicSupportApplicationIds、idempotencyKey は必須です。shortfallResolutionType が SELL_ASSETS の場合、shortfallResolutionAssetType も必須です。voluntaryDrawdownRequestedYen を指定する場合は0以上の整数である必要があります。',
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

  // Critical Fix #1: previously this threw 'not-found' unconditionally when
  // no household document existed yet — the exact gap the final
  // whole-branch review found (no production path ever created one). Now a
  // missing household triggers `lazyInitHouseholdWithAdminSdk`, which
  // performs its own authorization (see that function's doc comment) before
  // creating anything, so no membership check is skipped on this path.
  let household = await getHouseholdStateWithAdminSdk(data.lessonRunId, data.householdId)
  if (household) {
    await requireTeamMembership(data.lessonRunId, household.teamId, actorParticipantId)
  } else {
    household = await lazyInitHouseholdWithAdminSdk(data.lessonRunId, data.householdId, actorParticipantId)
  }

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
        ...(input.voluntaryDrawdownRequestedYen !== undefined ? { voluntaryDrawdownRequestedYen: input.voluntaryDrawdownRequestedYen } : {}),
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
      ...(data.voluntaryDrawdownRequestedYen !== undefined ? { voluntaryDrawdownRequestedYen: data.voluntaryDrawdownRequestedYen } : {}),
    })
  } catch (error) {
    throw translateSubmitHouseholdDecisionError(error)
  }
})

interface ProcessRoundRequest {
  lessonRunId: string
  householdId: string
  /**
   * Teacher-facing escape hatch (Task 11 review round 2) — allows settling
   * a household that has NOT submitted a decision this round (e.g. an
   * unreachable/absent student), bypassing the submission gate below.
   * Defaults to `false`/unset: without it, settling a household with no
   * submitted decision is rejected.
   */
  forceSettle?: boolean
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
    if (error.message === 'HouseholdDecision not submitted for this round') {
      return new HttpsError(
        'failed-precondition',
        'この家庭はまだラウンドの意思決定を提出していません。強制的に決算する場合は forceSettle を true にしてください。',
      )
    }
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
 * RTDB projections (`lessonRunPublic`/`lessonRunPrivate`/
 * `lessonRunTeamState`) ARE updated as part of this Callable's flow — see
 * `processRound.ts`'s `publishRealtimeState` step (Task 15). This
 * Callable itself does not touch RTDB directly; it just invokes
 * `processRoundWithAdminSdk`, which calls `publishRealtimeStateWithAdminSdk`
 * after the Firestore transaction commits.
 *
 * Submission gate (Task 11 review round 2, brief §Step 6): settling is
 * rejected unless this household has a submitted decision on record for
 * the round being settled, unless the teacher passes `forceSettle: true`.
 * See `processRound.ts`'s `ProcessRoundInput.forceSettle` doc comment for
 * the full reasoning and how this differs from `settleRound`'s own
 * `decision === null` auto-fallback.
 */
export const processRoundCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as ProcessRoundRequest
  if (!data.lessonRunId || !data.householdId) {
    throw new HttpsError('invalid-argument', 'lessonRunId、householdId は必須です。')
  }
  if (data.forceSettle !== undefined && typeof data.forceSettle !== 'boolean') {
    throw new HttpsError('invalid-argument', 'forceSettle は boolean である必要があります。')
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
      forceSettle: data.forceSettle ?? false,
    })
  } catch (error) {
    throw translateProcessRoundError(error)
  }
})

/**
 * Shared authorization for both checkpoint Callables below — deliberately
 * the exact same shape as `restoreCheckpointCallable` (`lessonRuns/onCall.ts`):
 * only a PRIMARY/ASSISTANT teacher on THIS run may write or restore a
 * checkpoint (a VIEWER must be rejected even though teacher() Firestore
 * rules let them read the run). `orgId` is always read from the run
 * document itself, never taken from client input, so a caller cannot point
 * `requireActiveOrgMember` at an org they belong to while acting on a run
 * that belongs to a different org.
 */
const requireCheckpointAuthority = async (lessonRunId: string, authUid: string): Promise<void> => {
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'> | undefined
  const role = teacherRoles?.[authUid]
  if (role !== 'PRIMARY' && role !== 'ASSISTANT') {
    throw new HttpsError('permission-denied', 'PRIMARYまたはASSISTANTの教師のみ利用できます。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, authUid)
}

interface WriteHouseholdCheckpointRequest {
  lessonRunId: string
  phaseId: string
  sequence: number
  householdIds: string[]
  idempotencyKey: string
}

/**
 * Translates `writeCheckpoint`'s (Phase A, `lessonRuns/checkpoint.ts`) bare
 * Error messages into HttpsError codes at the Callable boundary, same
 * convention as `translateProcessRoundError` above.
 */
const translateWriteHouseholdCheckpointError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/**
 * Teacher-facing checkpoint-write Callable — spec §13.18 (Task 13).
 * Authorization mirrors `restoreCheckpointCallable` exactly (see
 * `requireCheckpointAuthority` above). Reads every named household's
 * CURRENT `HouseholdState` document (never trusting client-supplied state,
 * same "read from Firestore, not from the request body" rule
 * `submitHouseholdDecisionCallable` follows), builds the opaque snapshot
 * payload with `buildHouseholdCheckpointSnapshot` (checkpointRestore.ts),
 * and hands it to Phase A's generic `writeCheckpointWithAdminSdk` — no new
 * Firestore schema, the `checkpoints` subcollection Phase A already owns is
 * reused as-is.
 */
export const writeHouseholdCheckpointCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as WriteHouseholdCheckpointRequest
  if (
    !data.lessonRunId || !data.phaseId
    || typeof data.sequence !== 'number' || !Number.isInteger(data.sequence) || data.sequence < 0
    || !Array.isArray(data.householdIds) || data.householdIds.length === 0
    || !data.householdIds.every((id) => typeof id === 'string' && id.length > 0)
    || !data.idempotencyKey
  ) {
    throw new HttpsError(
      'invalid-argument',
      'lessonRunId、phaseId、sequence、householdIds（1件以上）、idempotencyKey は必須です。',
    )
  }

  await requireCheckpointAuthority(data.lessonRunId, request.auth.uid)

  const households: HouseholdState[] = []
  for (const householdId of data.householdIds) {
    const household = await getHouseholdStateWithAdminSdk(data.lessonRunId, householdId)
    if (!household) throw new HttpsError('not-found', `対象の家庭の状態が見つかりません: ${householdId}`)
    households.push(household)
  }

  try {
    return await writeCheckpointWithAdminSdk({
      lessonRunId: data.lessonRunId,
      phaseId: data.phaseId,
      sequence: data.sequence,
      snapshot: buildHouseholdCheckpointSnapshot(households),
      createdBy: 'TEACHER',
      idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateWriteHouseholdCheckpointError(error)
  }
})

interface RestoreHouseholdCheckpointRequest {
  lessonRunId: string
  checkpointId: string
  reason: string
  idempotencyKey: string
}

/**
 * Translates `restoreCheckpoint`'s (Phase A) bare Error messages into
 * HttpsError codes at the Callable boundary, same convention as
 * `lessonRuns/onCall.ts`'s `translateRestoreCheckpointError`.
 */
const translateRestoreHouseholdCheckpointError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Checkpoint not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/**
 * Writes every restored `HouseholdState` back to its own document at
 * `lessonRuns/{lessonRunId}/households/{householdId}` — the same path and
 * `tx.set` shape `getOrInitHouseholdState` (Task 10, households/repository.ts)
 * writes to, via the same `householdRepositoryWithAdminSdk()` transaction
 * wiring. This is the one place Task 13 departs from Phase A's own
 * `restoreCheckpointCallable`, which does NOT write anything back (Phase
 * A's LessonRun is event-sourced and append-only by design — see
 * `checkpoint.ts`'s doc comment: "'Restore' is append, not rewind"). A
 * `HouseholdState` document is not event-sourced, though — it IS the
 * current, mutable state a household is in, read directly by
 * `submitHouseholdDecisionCallable`/`processRoundCallable` on every call —
 * so restoring a checkpoint here must overwrite those documents, or
 * "restore" would silently do nothing for home economics. All households
 * are written back inside a single transaction so a mid-restore failure
 * cannot leave some households restored and others not.
 */
const writeRestoredHouseholdsToFirestore = (lessonRunId: string, households: HouseholdState[]): Promise<void> =>
  householdRepositoryWithAdminSdk().runTransaction(async (tx) => {
    for (const household of households) {
      tx.set(`lessonRuns/${lessonRunId}/households/${household.householdId}`, household as unknown as Record<string, unknown>)
    }
  })

/**
 * Teacher-facing checkpoint-restore Callable — spec §13.18 (Task 13).
 * Authorization mirrors `restoreCheckpointCallable` exactly (see
 * `requireCheckpointAuthority` above). First delegates to Phase A's generic
 * `restoreCheckpointWithAdminSdk` to authorize-then-record the restore
 * (increments `LessonRun.restoreGeneration`, appends a
 * `CHECKPOINT_RESTORED` LessonEvent) — same as
 * `restoreCheckpointCallable`. Phase A's generic layer treats `snapshot` as
 * `unknown` and never reads it, so after that call this Callable reads the
 * checkpoint document's own `snapshot` field back out, decodes it with
 * `restoreHouseholdsFromSnapshot` (checkpointRestore.ts), and writes the
 * restored `HouseholdState`s back to Firestore — see
 * `writeRestoredHouseholdsToFirestore`'s doc comment for why this Callable
 * does that write and Phase A's own restore flow does not.
 */
export const restoreHouseholdCheckpointCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as RestoreHouseholdCheckpointRequest
  if (!data.lessonRunId || !data.checkpointId || !data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、checkpointId、reason、idempotencyKey は必須です。')
  }

  await requireCheckpointAuthority(data.lessonRunId, request.auth.uid)

  let restoreResult
  try {
    restoreResult = await restoreCheckpointWithAdminSdk({
      lessonRunId: data.lessonRunId, checkpointId: data.checkpointId,
      reason: data.reason, actorId: request.auth.uid, idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateRestoreHouseholdCheckpointError(error)
  }

  const checkpointSnap = await getFirestore().doc(`lessonRuns/${data.lessonRunId}/checkpoints/${data.checkpointId}`).get()
  if (!checkpointSnap.exists) throw new HttpsError('not-found', 'Checkpoint not found')
  const snapshot = checkpointSnap.get('snapshot') as HouseholdCheckpointSnapshot
  const restoredHouseholds = restoreHouseholdsFromSnapshot(snapshot)
  await writeRestoredHouseholdsToFirestore(data.lessonRunId, restoredHouseholds)

  return { ...restoreResult, restoredHouseholdIds: restoredHouseholds.map((household) => household.householdId) }
})
