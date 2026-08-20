import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import type { CourseFormat, HomeEconomicsContent } from '@stock-league/household-authoring-content'
import {
  getHouseholdRuntimeControlWithAdminSdk,
  getHouseholdStateWithAdminSdk,
  householdRepositoryWithAdminSdk,
  saveAdvancedHouseholdDecisionWithAdminSdk,
  saveHouseholdDecision,
} from '../lessonRuns/households/repository'
import type { HouseholdState } from '../lessonRuns/households/repository'
import { ensureCommonConditionsHouseholdState, resolveCommonConditionsProfile } from './commonConditionsHousehold'
import { ensureAssignedHouseholdStateWithAdminSdk } from './assignedHousehold'
import { canControlLesson } from '../lessonRuns/authorization'
import { requireActiveOrgMember } from '../organizations/authorization'
import { writeCheckpointWithAdminSdk } from '../lessonRuns/checkpoint'
import { idempotencyDocumentId } from '../lib/idempotency'
import { submitAdvancedHouseholdDecision, submitHouseholdDecision } from './submitDecision'
import type { HouseholdDecisionInput } from './submitDecision'
import { processRoundWithAdminSdk } from './processRound'
import { buildHouseholdCheckpointSnapshot } from './checkpointRestore'
import { findActiveBulkSettlementLeaseWithAdminSdk } from './bulkSettlementOperation'
import { loadHouseholdTeacherDashboardWithAdminSdk, normalizeTeamDisplayName } from './teacherDashboard'
import {
  processHouseholdRoundBatchWithAdminSdk,
  retryHouseholdRoundBatchWithAdminSdk,
} from './bulkSettlement'
import {
  saveManualAdvancedHouseholdCheckpointWithAdminSdk,
  saveManualHouseholdCheckpointWithAdminSdk,
} from './householdCheckpoint'
import { restoreHouseholdCheckpointWithAdminSdk } from './householdRestore'
import { readHouseholdFinalComparisonWithAdminSdk } from './finalComparison'
import type { AdvancedHouseholdCourseFormat } from './householdAssignment'
import {
  buildHouseholdAssignmentView,
  getHouseholdAssignmentView,
  householdAssignmentReadDepsWithAdminSdk,
  householdAssignmentRepositoryWithAdminSdk,
  prepareHouseholdAssignment,
  updateHouseholdAssignment,
} from './householdAssignmentRepository'

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
 * Important I2 (final whole-branch review): neither home-economics Callable
 * previously checked the LessonRun's `status` at all — a student could
 * submit a household decision, and a teacher could settle further rounds,
 * on a lesson that is already `COMPLETED`/`ABORTED`/`INTERRUPTED`/etc.
 *
 * Matches `market/onCall.ts`'s `isMarketAcceptingOrdersWithAdminSdk`
 * precedent exactly on the `status` field/value this repo already has
 * (`LessonRun.status === 'RUNNING'`, `lessonRuns/phases/stateMachine.ts`'s
 * `LessonRunStatus`) — no new "phase" or "status" concept is invented for
 * home economics. Unlike the market check, this does not also gate on a
 * `marketPaused`-equivalent flag: no such field exists for home-economics
 * lessonRuns, and inventing one is out of scope for this fix (STATUS only,
 * per this task's brief).
 *
 * Placed, in both Callables below, AFTER authorization has been established
 * (team/role membership resolved) but BEFORE any state-mutating work — the
 * same relative ordering `submitOrderCallable` uses (`requireTeamMembership`
 * → `getOrInitTeamAccount` init → `isMarketAcceptingOrdersWithAdminSdk` →
 * the actual mutating `submitOrder` call).
 */
const requireLessonRunRunning = async (lessonRunId: string): Promise<void> => {
  const db = getFirestore()
  const snap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const status = snap.get('status') as string | undefined
  if (status !== 'RUNNING') {
    throw new HttpsError('failed-precondition', 'このレッスンは実行中ではないため、この操作はできません。')
  }
}

/**
 * Task 5's Common-vs-advanced branch point. Mirrors `statusTransition.ts`'s
 * own private `ADVANCED_FORMATS`/`isAdvancedHouseholdCourseFormat` (not
 * exported from there — re-declared here rather than imported, matching
 * that file's own choice to keep this small set local to each call site).
 */
const ADVANCED_HOUSEHOLD_COURSE_FORMATS = new Set<AdvancedHouseholdCourseFormat>([
  'ROLE_VARIANT', 'STAGE_SPLIT', 'MULTI_PERSON_PER_TEAM',
])
const isAdvancedHouseholdCourseFormat = (value: unknown): value is AdvancedHouseholdCourseFormat =>
  typeof value === 'string' && ADVANCED_HOUSEHOLD_COURSE_FORMATS.has(value as AdvancedHouseholdCourseFormat)

/**
 * Resolves the LessonRun's `courseFormat` off its `templateSnapshot`, the
 * same field/path `statusTransition.ts`'s `prepareStatusTransition` reads
 * (`run.templateSnapshot?.homeEconomics?.courseFormat`). Used by
 * `submitHouseholdDecisionCallable` to decide whether to take the Common
 * lazy-init path or the advanced FROZEN-assignment path below. Throws
 * `not-found` when the LessonRun itself does not exist — the same message
 * every other helper in this file uses for a missing LessonRun doc.
 */
const resolveLessonRunCourseFormat = async (lessonRunId: string): Promise<CourseFormat | undefined> => {
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  return templateSnapshot?.homeEconomics?.courseFormat
}

/**
 * Resolves the `teamId`/`profileId` a runtime `householdId` is assigned to
 * from the FROZEN `HouseholdAssignmentConfig`/`HouseholdAssignmentEntry`
 * (Task 2/3) — read directly by doc id, since entries are persisted at
 * `.../entries/{householdId}` (`householdAssignmentRepository.ts`'s
 * `entryPath`). Used ONLY to authorize a caller against a household that
 * does not exist yet — this never creates anything itself. Throws
 * `HttpsError` directly (this helper lives at the Callable boundary, same
 * as `requireTeamMembership`/`requireLessonRunRunning` above) rather than a
 * bare `Error` translated elsewhere.
 */
const resolveFrozenAssignmentEntry = async (
  lessonRunId: string, householdId: string,
): Promise<{ teamId: string; profileId: string; assignmentRevision: number }> => {
  const db = getFirestore()
  const configSnap = await db.doc(`lessonRuns/${lessonRunId}/householdAssignment/config`).get()
  if (!configSnap.exists) {
    throw new HttpsError('failed-precondition', 'この授業の家庭割り当てはまだ準備されていません。')
  }
  const config = configSnap.data() as { state: string; assignmentRevision: number }
  if (config.state !== 'FROZEN') {
    throw new HttpsError('failed-precondition', `家庭割り当てが確定（FROZEN）されるまで、家庭を初期化できません（現在の状態: ${config.state}）。`)
  }
  const entrySnap = await db.doc(`lessonRuns/${lessonRunId}/householdAssignment/config/entries/${householdId}`).get()
  if (!entrySnap.exists) {
    throw new HttpsError('not-found', `対象の家庭の割り当てが見つかりません: ${householdId}`)
  }
  const entry = entrySnap.data() as { teamId: string; profileId: string }
  return { teamId: entry.teamId, profileId: entry.profileId, assignmentRevision: config.assignmentRevision }
}

/**
 * Advanced-format (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM)
 * counterpart to `lazyInitHouseholdWithAdminSdk` below. Security ordering is
 * the whole point (per this task's brief): an existing household is
 * authorized against ITS OWN stored `teamId` exactly like Common; a MISSING
 * household's owning `teamId` is resolved from the FROZEN assignment and
 * membership is checked against THAT `teamId` BEFORE
 * `ensureAssignedHouseholdStateWithAdminSdk` (Task 4) is ever called — so a
 * caller can never cause a household document to be created, or learn
 * whether one exists, for a team they are not a member of.
 */
const resolveAdvancedHousehold = async (
  lessonRunId: string, householdId: string, actorParticipantId: string,
): Promise<HouseholdState> => {
  const existing = await getHouseholdStateWithAdminSdk(lessonRunId, householdId)
  if (existing) {
    await requireTeamMembership(lessonRunId, existing.teamId, actorParticipantId)
    return existing
  }

  const { teamId } = await resolveFrozenAssignmentEntry(lessonRunId, householdId)
  await requireTeamMembership(lessonRunId, teamId, actorParticipantId)

  try {
    return await ensureAssignedHouseholdStateWithAdminSdk(lessonRunId, householdId)
  } catch (error) {
    if (error instanceof Error) throw new HttpsError('failed-precondition', error.message)
    throw error
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
  if (!homeEconomics) {
    throw new HttpsError(
      'failed-precondition',
      'このコース形式では家庭の自動初期化に対応していません（共通条件モードでプロフィールが1件の教材のみ対応）。',
    )
  }
  try {
    return await ensureCommonConditionsHouseholdState({
      firestore: householdRepositoryWithAdminSdk(),
      lessonRunId,
      teamId: householdId,
      content: homeEconomics,
      now: Date.now,
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('このコース形式では家庭の自動初期化に対応していません')) {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
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
    // Task 5: `saveAdvancedHouseholdDecisionWithAdminSdk`'s
    // `HouseholdRuntimeControl`/round-consistency guard messages
    // (`lessonRuns/households/repository.ts`).
    if (error.message === 'HouseholdRuntimeControl not found') return new HttpsError('not-found', error.message)
    if (error.message === 'HouseholdState not found') return new HttpsError('not-found', error.message)
    if (error.message === 'HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message === 'HouseholdRuntimeControl assignmentRevision does not match the expected assignment revision') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message === 'HouseholdState roundIndex does not match HouseholdRuntimeControl synchronizedRoundIndex') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message === 'Requested round no longer matches the synchronized round') {
      return new HttpsError('failed-precondition', error.message)
    }
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

  // Task 5: branch on the LessonRun's own courseFormat — the 3 advanced
  // formats (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM) route through a
  // parallel resolution/save path (`resolveAdvancedHousehold` +
  // `saveAdvancedHouseholdDecisionWithAdminSdk`) guarded by the shared
  // `HouseholdRuntimeControl` document; COMMON_CONDITIONS keeps the
  // pre-existing lazy-init/`saveHouseholdDecision` flow below entirely
  // unchanged.
  const courseFormat = await resolveLessonRunCourseFormat(data.lessonRunId)
  if (isAdvancedHouseholdCourseFormat(courseFormat)) {
    const household = await resolveAdvancedHousehold(data.lessonRunId, data.householdId, actorParticipantId)

    // Important I2 (mirrors the Common flow below): gate on LessonRun status
    // AFTER authorization has resolved, but BEFORE the roundIndex check and
    // the actual decision-saving transaction.
    await requireLessonRunRunning(data.lessonRunId)

    if (data.roundIndex !== household.roundIndex) {
      throw new HttpsError('failed-precondition', 'この家庭は現在別のラウンドです。roundIndex が一致しません。')
    }

    const control = await getHouseholdRuntimeControlWithAdminSdk(data.lessonRunId)
    if (!control) {
      throw new HttpsError('failed-precondition', 'この授業の家庭運用制御ドキュメントが見つかりません。')
    }

    const idempotencyId = idempotencyDocumentId(
      `${data.lessonRunId}/${data.householdId}/${data.roundIndex}`, data.idempotencyKey,
    )
    const decisionId = `${data.lessonRunId}_decision_${idempotencyId}`

    try {
      return await submitAdvancedHouseholdDecision({
        saveDecision: (input) => saveAdvancedHouseholdDecisionWithAdminSdk({
          firestore: householdRepositoryWithAdminSdk(),
          lessonRunId: input.lessonRunId,
          householdId: input.householdId,
          decision: input.decision,
          expectedSynchronizedRoundIndex: input.expectedSynchronizedRoundIndex,
          assignmentRevision: input.assignmentRevision,
          idempotencyKey: input.idempotencyKey,
          nowMillis: input.nowMillis,
        }),
        lessonRunId: data.lessonRunId,
        householdId: data.householdId,
        decision: {
          decisionId,
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
        },
        expectedSynchronizedRoundIndex: data.roundIndex,
        assignmentRevision: control.assignmentRevision,
        idempotencyKey: data.idempotencyKey,
        nowMillis: Date.now(),
      })
    } catch (error) {
      throw translateSubmitHouseholdDecisionError(error)
    }
  }

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

  // Important I2: gate on the LessonRun's own status AFTER authorization
  // (team membership / lazy-init) has resolved, but BEFORE the roundIndex
  // check and the actual decision-saving mutation below — see
  // `requireLessonRunRunning`'s doc comment for the market precedent this
  // mirrors.
  await requireLessonRunRunning(data.lessonRunId)

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

  // Important I2: gate on the LessonRun's own status AFTER authorization
  // (teacher role + active org membership) has resolved, but BEFORE the
  // actual round-settlement mutation below — mirrors
  // `submitHouseholdDecisionCallable`'s placement and the market precedent
  // (see `requireLessonRunRunning`'s doc comment). Reuses `runSnap`, already
  // fetched above for `teacherRoles`/`orgId` — no extra read.
  const status = runSnap.get('status') as string | undefined
  if (status !== 'RUNNING') {
    throw new HttpsError('failed-precondition', 'このレッスンは実行中ではないため、この操作はできません。')
  }

  // Task 6 / Global Constraint: 発展3形式（ROLE_VARIANT/STAGE_SPLIT/
  // MULTI_PERSON_PER_TEAM）は通常の個別決算を server-side で拒否する —
  // these formats settle ONLY through the bulk path
  // (`processHouseholdRoundBatchCallable`/`retryHouseholdRoundBatchCallable`),
  // which internally calls `processRoundWithAdminSdk` per household itself
  // (unchanged, still callable — only THIS teacher-facing individual-settle
  // Callable gains the rejection). Reuses `runSnap`, already fetched above
  // for `teacherRoles`/`orgId`/`status` — no extra read.
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  const courseFormat = templateSnapshot?.homeEconomics?.courseFormat
  if (isAdvancedHouseholdCourseFormat(courseFormat)) {
    throw new HttpsError(
      'failed-precondition',
      'この授業形式（発展形式）では個別の決算は利用できません。一括決算を利用してください。',
    )
  }

  const activeLease = await findActiveBulkSettlementLeaseWithAdminSdk(data.lessonRunId, Date.now())
  if (activeLease) {
    throw new HttpsError('failed-precondition', '一括決算処理が実行中のため、個別の決算は行えません。')
  }

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
 * Teacher-facing dashboard loader Callable.
 */
interface GetHouseholdTeacherDashboardRequest {
  lessonRunId: string
}

export const getHouseholdTeacherDashboardCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as GetHouseholdTeacherDashboardRequest
  if (!data.lessonRunId || typeof data.lessonRunId !== 'string') {
    throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  const subject = runSnap.get('subject') as string | undefined
  if (subject !== 'HOME_ECONOMICS') {
    throw new HttpsError('failed-precondition', 'LessonRun subject is not HOME_ECONOMICS')
  }

  // Task 10: the dashboard projection is now generalized to a team-primary
  // shape that covers all 4 course formats (COMMON_CONDITIONS plus the 3
  // advanced formats) — the course-format restriction that used to live
  // here has been removed. `loadHouseholdTeacherDashboardWithAdminSdk`
  // itself now branches internally by `courseFormat`.
  try {
    return await loadHouseholdTeacherDashboardWithAdminSdk(data.lessonRunId, Date.now())
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error instanceof Error) {
      if (error.message.includes('not found')) throw new HttpsError('not-found', error.message)
      throw new HttpsError('internal', error.message)
    }
    throw error
  }
})

/**
 * Teacher-facing bulk round settlement Callable.
 */
interface ProcessHouseholdRoundBatchCallableRequest {
  lessonRunId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  idempotencyKey: string
}

export const processHouseholdRoundBatchCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as ProcessHouseholdRoundBatchCallableRequest
  if (
    !data.lessonRunId || typeof data.lessonRunId !== 'string' ||
    typeof data.expectedRoundIndex !== 'number' || !Number.isInteger(data.expectedRoundIndex) || data.expectedRoundIndex < 0 ||
    typeof data.forceUnsubmitted !== 'boolean' ||
    !data.idempotencyKey || typeof data.idempotencyKey !== 'string'
  ) {
    throw new HttpsError('invalid-argument', 'lessonRunId, expectedRoundIndex (非負整数), forceUnsubmitted (boolean), idempotencyKey は必須です。')
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

  const status = runSnap.get('status') as string | undefined
  if (status !== 'RUNNING') {
    throw new HttpsError('failed-precondition', 'このレッスンは実行中ではないため、この操作はできません。')
  }

  try {
    return await processHouseholdRoundBatchWithAdminSdk({
      lessonRunId: data.lessonRunId,
      expectedRoundIndex: data.expectedRoundIndex,
      forceUnsubmitted: data.forceUnsubmitted,
      actorUid: request.auth.uid,
      idempotencyKey: data.idempotencyKey,
      nowMillis: Date.now(),
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error instanceof Error) {
      if (error.message.includes('Idempotency key payload mismatch')) throw new HttpsError('failed-precondition', error.message)
      if (error.message.includes('未提出') || error.message.includes('不一致') || error.message.includes('存在します')) {
        throw new HttpsError('failed-precondition', error.message)
      }
      throw new HttpsError('internal', error.message)
    }
    throw error
  }
})

/**
 * Teacher-facing retry for failed/incomplete bulk round settlement.
 */
interface RetryHouseholdRoundBatchCallableRequest {
  lessonRunId: string
  operationId: string
}

export const retryHouseholdRoundBatchCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as RetryHouseholdRoundBatchCallableRequest
  if (!data.lessonRunId || typeof data.lessonRunId !== 'string' || !data.operationId || typeof data.operationId !== 'string') {
    throw new HttpsError('invalid-argument', 'lessonRunId, operationId は必須です。')
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

  const status = runSnap.get('status') as string | undefined
  if (status !== 'RUNNING') {
    throw new HttpsError('failed-precondition', 'このレッスンは実行中ではないため、この操作はできません。')
  }

  try {
    return await retryHouseholdRoundBatchWithAdminSdk({
      lessonRunId: data.lessonRunId,
      operationId: data.operationId,
      actorUid: request.auth.uid,
      nowMillis: Date.now(),
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error instanceof Error) {
      if (error.message.includes('not found')) throw new HttpsError('not-found', error.message)
      if (error.message.includes('チェックポイント復元') || error.message.includes('mismatch')) throw new HttpsError('failed-precondition', error.message)
      throw new HttpsError('internal', error.message)
    }
    throw error
  }
})

/**
 * Shared authorization for both checkpoint Callables below. Also returns the
 * LessonRun's `courseFormat` (defaulting to `COMMON_CONDITIONS` when the
 * template snapshot has none) — `writeHouseholdCheckpointCallable`'s manual
 * checkpoint path uses this SAME read to dispatch Common -> v2, advanced ->
 * v3 (Task 7), rather than reading the run doc a second time.
 */
const requireCheckpointAuthority = async (
  lessonRunId: string, authUid: string,
): Promise<{ courseFormat: string }> => {
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
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: { courseFormat?: string } } | undefined
  return { courseFormat: templateSnapshot?.homeEconomics?.courseFormat ?? 'COMMON_CONDITIONS' }
}

interface WriteHouseholdCheckpointRequest {
  lessonRunId: string
  label?: string
  phaseId?: string
  sequence?: number
  householdIds?: string[]
  idempotencyKey: string
}

/**
 * Translates `writeCheckpoint`'s bare Error messages into HttpsError codes.
 */
const translateWriteHouseholdCheckpointError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message.includes('Label must be')) return new HttpsError('invalid-argument', error.message)
    if (error.message.includes('Active bulk operation lease')) return new HttpsError('failed-precondition', error.message)
    // Advanced (v3) manual-checkpoint path: same
    // `HouseholdRuntimeControl` guard messages Task 5/6 established
    // (`saveManualAdvancedHouseholdCheckpointWithAdminSdk`,
    // `translateSubmitHouseholdDecisionError` above).
    if (error.message === 'HouseholdRuntimeControl not found') return new HttpsError('not-found', error.message)
    if (error.message === 'HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)') {
      return new HttpsError('failed-precondition', error.message)
    }
  }
  return error
}

/**
 * Teacher-facing checkpoint-write Callable.
 */
export const writeHouseholdCheckpointCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as WriteHouseholdCheckpointRequest

  if (!data.lessonRunId || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、idempotencyKey は必須です。')
  }

  // If label is not provided, validate legacy parameters before reading DB
  if (typeof data.label !== 'string') {
    if (
      !data.phaseId
      || typeof data.sequence !== 'number' || !Number.isInteger(data.sequence) || data.sequence < 0
      || !Array.isArray(data.householdIds) || data.householdIds.length === 0
      || !data.householdIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'lessonRunId、phaseId、sequence、householdIds（1件以上）、idempotencyKey は必須です。',
      )
    }
  }

  const { courseFormat } = await requireCheckpointAuthority(data.lessonRunId, request.auth.uid)

  // Manual checkpoint path — dispatch by courseFormat: Common (no
  // per-team assignment, one household per team) -> v2; the 3 advanced
  // formats (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM) -> v3. Both
  // share the SAME PRIMARY/ASSISTANT authority check above.
  if (typeof data.label === 'string') {
    try {
      if (isAdvancedHouseholdCourseFormat(courseFormat)) {
        return await saveManualAdvancedHouseholdCheckpointWithAdminSdk({
          lessonRunId: data.lessonRunId,
          label: data.label,
          actorUid: request.auth.uid,
          idempotencyKey: data.idempotencyKey,
        })
      }
      return await saveManualHouseholdCheckpointWithAdminSdk({
        lessonRunId: data.lessonRunId,
        label: data.label,
        actorUid: request.auth.uid,
        idempotencyKey: data.idempotencyKey,
      })
    } catch (error) {
      throw translateWriteHouseholdCheckpointError(error)
    }
  }

  // Legacy v1 fallback path
  const households: HouseholdState[] = []
  for (const householdId of data.householdIds!) {
    const h = await getHouseholdStateWithAdminSdk(data.lessonRunId, householdId)
    if (!h) throw new HttpsError('not-found', `対象の家庭の状態が見つかりません: ${householdId}`)
    households.push(h)
  }

  try {
    return await writeCheckpointWithAdminSdk({
      lessonRunId: data.lessonRunId,
      phaseId: data.phaseId!,
      sequence: data.sequence!,
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
 * Translates `restoreCheckpoint` bare Error messages into HttpsError codes.
 */
const translateRestoreHouseholdCheckpointError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Checkpoint not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message.includes('Active bulk operation lease')) return new HttpsError('failed-precondition', error.message)
    if (error.message.includes('復元できるのは')) return new HttpsError('failed-precondition', error.message)
    if (error.message === 'HouseholdRuntimeControl not found') return new HttpsError('not-found', error.message)
    if (error.message === 'HouseholdAssignment not found') return new HttpsError('not-found', error.message)
    if (error.message === 'HouseholdAssignment is not FROZEN') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'HouseholdAssignment assignmentRevision does not match the checkpoint snapshot') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message.includes('より新しい世代の復元が行われた')) return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/**
 * Teacher-facing checkpoint-restore Callable. Retains its external shape
 * unchanged (Task 8) — internally now dispatches by checkpoint schema
 * version via `restoreHouseholdCheckpointWithAdminSdk` (v2 Common-only /
 * v3 advanced-format), instead of always calling the v2 restore flow.
 */
export const restoreHouseholdCheckpointCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as RestoreHouseholdCheckpointRequest
  if (!data.lessonRunId || !data.checkpointId || !data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、checkpointId、reason、idempotencyKey は必須です。')
  }

  await requireCheckpointAuthority(data.lessonRunId, request.auth.uid)

  try {
    return await restoreHouseholdCheckpointWithAdminSdk({
      lessonRunId: data.lessonRunId,
      checkpointId: data.checkpointId,
      reason: data.reason,
      actorUid: request.auth.uid,
      idempotencyKey: data.idempotencyKey,
      nowMillis: Date.now(),
    })
  } catch (error) {
    throw translateRestoreHouseholdCheckpointError(error)
  }
})

/**
 * Household assignment (Task 2) — the pre-lesson plan of which
 * `HouseholdProfile` each team plays, for the 3 advanced course formats
 * (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM). This section does NOT
 * touch lesson start/freeze logic (Task 3+) — `prepare`/`update` only
 * operate on the pre-start DRAFT plan; nothing here writes `HouseholdState`.
 */
interface HouseholdAssignmentContext {
  homeEconomics: HomeEconomicsContent
  courseFormat: CourseFormat
  teamIds: string[]
  teamDisplayNames: Record<string, string>
}

/**
 * Shared context loader for all three household-assignment Callables below.
 * Takes the already-fetched `runSnap` (every caller reads it first anyway,
 * to resolve `teacherRoles`/`orgId` for authorization) rather than
 * re-fetching it, mirroring `processRoundCallable`'s single-read pattern.
 */
const loadHouseholdAssignmentContext = async (
  lessonRunId: string,
  runSnap: FirebaseFirestore.DocumentSnapshot,
): Promise<HouseholdAssignmentContext> => {
  const subject = runSnap.get('subject') as string | undefined
  if (subject !== 'HOME_ECONOMICS') throw new HttpsError('failed-precondition', 'LessonRun subject is not HOME_ECONOMICS')
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  const homeEconomics = templateSnapshot?.homeEconomics
  if (!homeEconomics) throw new HttpsError('failed-precondition', 'LessonRun has no homeEconomics content')

  const db = getFirestore()
  const teamsIndexSnap = await db.doc(`lessonRuns/${lessonRunId}/meta/teamsIndex`).get()
  const teamIds = (teamsIndexSnap.exists ? (teamsIndexSnap.get('teamIds') as string[] | undefined) : undefined) ?? []

  const teamsSnap = await db.collection(`lessonRuns/${lessonRunId}/teams`).get()
  const teamDisplayNames: Record<string, string> = {}
  for (const doc of teamsSnap.docs) teamDisplayNames[doc.id] = normalizeTeamDisplayName(doc.id, doc.data())

  return { homeEconomics, courseFormat: homeEconomics.courseFormat, teamIds, teamDisplayNames }
}

/**
 * Translates the pure/DI repository layer's bare Error messages into
 * HttpsError codes, matching every other task's convention in this file
 * (`translateSubmitHouseholdDecisionError`, `translateProcessRoundError`).
 */
const translateHouseholdAssignmentError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'HouseholdAssignment is frozen') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'HouseholdAssignment not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Revision mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message.startsWith('HouseholdAssignmentEntry not found')) return new HttpsError('not-found', error.message)
    if (error.message.includes('MULTI_PERSON_PER_TEAM does not support')) return new HttpsError('invalid-argument', error.message)
  }
  return error
}

interface GetHouseholdAssignmentRequest {
  lessonRunId: string
}

/**
 * Teacher-facing read-only projection — any teacher role with
 * `VIEW_PROGRESS` (i.e. every role: PRIMARY/ASSISTANT/VIEWER) may call this,
 * matching `getHouseholdTeacherDashboardCallable`'s precedent of using the
 * broadest read action for a dashboard-style view.
 */
export const getHouseholdAssignmentCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as GetHouseholdAssignmentRequest
  if (!data.lessonRunId || typeof data.lessonRunId !== 'string') {
    throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role || !canControlLesson(role, 'VIEW_PROGRESS')) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  const context = await loadHouseholdAssignmentContext(data.lessonRunId, runSnap)
  const commonProfile = context.courseFormat === 'COMMON_CONDITIONS'
    ? resolveCommonConditionsProfile(context.homeEconomics)
    : undefined

  return getHouseholdAssignmentView({
    lessonRunId: data.lessonRunId,
    courseFormat: context.courseFormat,
    currentTeamIds: context.teamIds,
    teamDisplayNames: context.teamDisplayNames,
    profiles: context.homeEconomics.households,
    commonProfile,
    deps: householdAssignmentReadDepsWithAdminSdk(),
  })
})

interface PrepareHouseholdAssignmentRequest {
  lessonRunId: string
  idempotencyKey: string
}

/**
 * PRIMARY-only (`MANAGE_HOUSEHOLD_ASSIGNMENT`, see `authorization.ts`).
 * First generation or STALE reconciliation for the 3 advanced formats —
 * never for COMMON_CONDITIONS, which has no persisted assignment plan (see
 * `householdAssignmentRepository.ts`'s `getHouseholdAssignmentView` doc
 * comment). Rejects once the assignment is FROZEN (a later task's
 * lesson-start flow sets that) — this Callable never freezes anything
 * itself.
 */
export const prepareHouseholdAssignmentCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as PrepareHouseholdAssignmentRequest
  if (!data.lessonRunId || typeof data.lessonRunId !== 'string' || !data.idempotencyKey || typeof data.idempotencyKey !== 'string') {
    throw new HttpsError('invalid-argument', 'lessonRunId、idempotencyKey は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role || !canControlLesson(role, 'MANAGE_HOUSEHOLD_ASSIGNMENT')) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  const context = await loadHouseholdAssignmentContext(data.lessonRunId, runSnap)
  if (context.courseFormat === 'COMMON_CONDITIONS') {
    throw new HttpsError('failed-precondition', 'COMMON_CONDITIONS では家庭割り当ての準備は不要です。')
  }

  try {
    const result = await prepareHouseholdAssignment({
      firestore: householdAssignmentRepositoryWithAdminSdk(),
      lessonRunId: data.lessonRunId,
      courseFormat: context.courseFormat as AdvancedHouseholdCourseFormat,
      teamIds: context.teamIds,
      profiles: context.homeEconomics.households,
      actorUid: request.auth.uid,
      idempotencyKey: data.idempotencyKey,
      now: Date.now,
    })
    return buildHouseholdAssignmentView({
      lessonRunId: data.lessonRunId,
      courseFormat: context.courseFormat,
      config: result.config,
      entries: result.entries,
      currentTeamIds: context.teamIds,
      teamDisplayNames: context.teamDisplayNames,
      profiles: context.homeEconomics.households,
    })
  } catch (error) {
    throw translateHouseholdAssignmentError(error)
  }
})

interface UpdateHouseholdAssignmentRequest {
  lessonRunId: string
  expectedRevision: number
  changes: Array<{ householdId: string; profileId?: string; displayOrder?: number }>
  idempotencyKey: string
}

const isValidHouseholdAssignmentChanges = (value: unknown): value is UpdateHouseholdAssignmentRequest['changes'] =>
  Array.isArray(value) && value.length > 0 && value.every((change) =>
    typeof change === 'object' && change !== null
    && typeof (change as { householdId?: unknown }).householdId === 'string' && (change as { householdId: string }).householdId.length > 0
    && ((change as { profileId?: unknown }).profileId === undefined || typeof (change as { profileId: unknown }).profileId === 'string')
    && ((change as { displayOrder?: unknown }).displayOrder === undefined || (typeof (change as { displayOrder: unknown }).displayOrder === 'number' && Number.isInteger((change as { displayOrder: number }).displayOrder))))

/**
 * PRIMARY-only (`MANAGE_HOUSEHOLD_ASSIGNMENT`). Applies per-household
 * `profileId`/`displayOrder` edits against `expectedRevision` (optimistic
 * concurrency — see `updateHouseholdAssignment`'s doc comment). Rejects
 * once FROZEN, exactly like `prepareHouseholdAssignmentCallable`.
 */
export const updateHouseholdAssignmentCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as UpdateHouseholdAssignmentRequest
  if (
    !data.lessonRunId || typeof data.lessonRunId !== 'string'
    || typeof data.expectedRevision !== 'number' || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 0
    || !isValidHouseholdAssignmentChanges(data.changes)
    || !data.idempotencyKey || typeof data.idempotencyKey !== 'string'
  ) {
    throw new HttpsError('invalid-argument', 'lessonRunId、expectedRevision、changes（1件以上）、idempotencyKey は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role || !canControlLesson(role, 'MANAGE_HOUSEHOLD_ASSIGNMENT')) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  const context = await loadHouseholdAssignmentContext(data.lessonRunId, runSnap)
  if (context.courseFormat === 'COMMON_CONDITIONS') {
    throw new HttpsError('failed-precondition', 'COMMON_CONDITIONS では家庭割り当ての編集は不要です。')
  }

  try {
    const result = await updateHouseholdAssignment({
      firestore: householdAssignmentRepositoryWithAdminSdk(),
      lessonRunId: data.lessonRunId,
      courseFormat: context.courseFormat as AdvancedHouseholdCourseFormat,
      teamIds: context.teamIds,
      profiles: context.homeEconomics.households,
      expectedRevision: data.expectedRevision,
      changes: data.changes,
      actorUid: request.auth.uid,
      idempotencyKey: data.idempotencyKey,
      now: Date.now,
    })
    return buildHouseholdAssignmentView({
      lessonRunId: data.lessonRunId,
      courseFormat: context.courseFormat,
      config: result.config,
      entries: result.entries,
      currentTeamIds: context.teamIds,
      teamDisplayNames: context.teamDisplayNames,
      profiles: context.homeEconomics.households,
    })
  } catch (error) {
    throw translateHouseholdAssignmentError(error)
  }
})

interface ShowHouseholdComparisonOnDisplayRequest {
  lessonRunId: string
}

/**
 * Task 13: teacher-triggered classroom-projector switch to the privacy-safe
 * final comparison ("教室画面に表示"). Auth mirrors
 * `requireCheckpointAuthority` above — the same PRIMARY/ASSISTANT + active-
 * org-member gate `writeHouseholdCheckpointCallable` uses — reused directly
 * rather than re-implemented, so this Callable never has authorization logic
 * to drift out of sync with its sibling.
 *
 * SECURITY-CRITICAL (this task's own highest-risk property): `request.data`
 * carries ONLY `lessonRunId` — never a comparison payload. The safe
 * `HouseholdClassComparisonPublicView` snapshot is read back from
 * Firestore's `householdFinalComparison/result`
 * (`readHouseholdFinalComparisonWithAdminSdk`, `finalComparison.ts` — the
 * SAME already-computed, already-privacy-filtered document
 * `afterReflectionTransition` republishes from) and written to
 * `lessonRunDisplay/{lessonRunId}` VERBATIM. A malicious or buggy client
 * cannot inject arbitrary content onto the shared classroom projector this
 * way — there is no code path here that ever reads a comparison shape out
 * of `request.data`.
 *
 * `failed-precondition` when no snapshot exists yet (lesson hasn't reached
 * REFLECTION, or Task 12's gate never fired) — matches this file's
 * established convention of `failed-precondition` for "the lesson isn't in
 * the right state for this action yet" (e.g. `requireLessonRunRunning`,
 * `translateProcessRoundError`'s unsubmitted-decision case above).
 *
 * DESIGN NOTE — accepted `.set()`-vs-`.update()` race with the generic
 * publish path: `setDisplayState` (`publicProjection.ts`) still does a
 * whole-node `.set()` on every generic `publishLessonProjectionWithAdminSdk`
 * call (phase transitions) and on every `setTeacherGuidanceCallable` edit,
 * and `toLessonRunDisplayState` always recomputes `mode` fresh from
 * `deriveDisplayMode(status)` — so a publish that happens AFTER this
 * Callable runs will silently revert the projector's `mode` (and drop
 * `householdClassComparison` entirely, since `.set()` replaces the whole
 * node) back to the status-derived value (`EXPLANATION` for REFLECTION,
 * where this mode is exclusively meaningful). This write below
 * deliberately uses `.update()` — not `.set()` — so it only ever touches
 * `mode`/`householdClassComparison`/`updatedAtMillis`, leaving
 * orgId/title/goal/teams/teacherGuidance exactly as the last generic
 * publish left them; that is the full extent of the fix applied here.
 * Making the reverse direction race-free (a generic publish preserving an
 * already-HOUSEHOLD_COMPARISON mode) would require a read-before-write in
 * `toLessonRunDisplayState`'s call site, which is otherwise a pure function
 * — rejected as unwarranted complexity for what is, in practice, a rare,
 * manually-toggled, low-consequence display mode: REFLECTION is a
 * long-lived, mostly-static phase (the lesson has already stopped
 * progressing through phases), so the realistic reset triggers are a
 * teacher explicitly editing 教室表示のメッセージ (an action they immediately see
 * the result of and can redo) or a genuine phase transition (which SHOULD
 * legitimately leave HOUSEHOLD_COMPARISON, since the class has moved on).
 */
export const showHouseholdComparisonOnDisplayCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as ShowHouseholdComparisonOnDisplayRequest
  if (typeof data.lessonRunId !== 'string' || data.lessonRunId === '') {
    throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')
  }

  await requireCheckpointAuthority(data.lessonRunId, request.auth.uid)

  const comparison = await readHouseholdFinalComparisonWithAdminSdk(data.lessonRunId)
  if (!comparison) {
    throw new HttpsError('failed-precondition', 'クラス比較がまだ準備されていません。授業がREFLECTIONに進んでから再試行してください。')
  }

  await getDatabase().ref(`lessonRunDisplay/${data.lessonRunId}`).update({
    mode: 'HOUSEHOLD_COMPARISON',
    householdClassComparison: comparison,
    updatedAtMillis: Date.now(),
  })
})
