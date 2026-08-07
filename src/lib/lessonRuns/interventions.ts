import { httpsCallable, type Functions } from 'firebase/functions'

/**
 * Mirrors functions/src/lessonRuns/interventions.ts's server-side union
 * exactly (see that file's `lessonInterventionTypes`). Duplicated here
 * because functions/ and src/ do not share a types module today — every
 * other client wrapper in this directory (transitionPhase.ts's
 * `LessonRunStatus` re-declaration) follows the same "duplicated by
 * necessity" convention. Keep byte-for-byte identical if either changes.
 */
export type LessonInterventionType =
  | 'EXTEND_TIME'
  | 'PROXY_CONFIRM'
  | 'CHANGE_REPRESENTATIVE'
  | 'RECONNECT_PARTICIPANT'
  | 'SWITCH_DISPLAY_SLIDE'
  | 'CORRECT_STATE'
  | 'RESTORE_PREVIOUS_PHASE'
  | 'EMERGENCY_STOP'
  | 'HIDE_INFORMATION'

export type InterventionImpactScope =
  | { level: 'PARTICIPANT'; participantId: string }
  | { level: 'TEAM'; teamId: string }
  | { level: 'LESSON' }

export interface TransferPrimaryTeacherInput {
  lessonRunId: string
  newPrimaryTeacherUid: string
  reason: string
  idempotencyKey: string
}
export interface TransferPrimaryTeacherResult {
  previousPrimaryTeacherUid: string
  newPrimaryTeacherUid: string
  deduplicated: boolean
}

/**
 * Client wrapper for the transferPrimaryTeacherCallable Callable.
 * `callerUid` is resolved server-side from the verified auth token — the
 * client never supplies it, matching every other lessonRuns Callable
 * wrapper's `actorId` handling (transitionPhase.ts, recovery.ts).
 */
export const transferPrimaryTeacher = async (
  functions: Functions,
  input: TransferPrimaryTeacherInput,
): Promise<TransferPrimaryTeacherResult> => {
  const callable = httpsCallable<TransferPrimaryTeacherInput, TransferPrimaryTeacherResult>(functions, 'transferPrimaryTeacherCallable')
  const result = await callable(input)
  return result.data
}

export interface ApplyTeacherInterventionInput {
  lessonRunId: string
  type: LessonInterventionType
  reason: string
  before: unknown
  after: unknown
  impactScope: InterventionImpactScope
  detail: Record<string, unknown>
  idempotencyKey: string
}
export interface ApplyTeacherInterventionResult {
  type: LessonInterventionType
  eventId: string
  deduplicated: boolean
  delegatedResult?: unknown
}

/**
 * Client wrapper for the applyTeacherInterventionCallable Callable —
 * covers all 9 §6.5 mid-lesson teacher interventions (EXTEND_TIME,
 * PROXY_CONFIRM, CHANGE_REPRESENTATIVE, RECONNECT_PARTICIPANT,
 * SWITCH_DISPLAY_SLIDE, CORRECT_STATE, RESTORE_PREVIOUS_PHASE,
 * EMERGENCY_STOP, HIDE_INFORMATION) through one shared envelope, matching
 * the server-side `applyTeacherIntervention`'s single-dispatcher shape
 * (functions/src/lessonRuns/interventions.ts). `actorId` is resolved
 * server-side, never sent by the client.
 */
export const applyTeacherIntervention = async (
  functions: Functions,
  input: ApplyTeacherInterventionInput,
): Promise<ApplyTeacherInterventionResult> => {
  const callable = httpsCallable<ApplyTeacherInterventionInput, ApplyTeacherInterventionResult>(functions, 'applyTeacherInterventionCallable')
  const result = await callable(input)
  return result.data
}
