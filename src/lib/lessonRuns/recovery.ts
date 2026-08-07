import { httpsCallable, type Functions } from 'firebase/functions'

export interface IssueRecoveryCodeInput {
  lessonRunId: string
  participantId: string
  idempotencyKey: string
}
export interface IssueRecoveryCodeResult {
  code: string
  deduplicated: boolean
}

/**
 * Client wrapper for the issueRecoveryCodeCallable Callable (teacher-only —
 * see participants/onCall.ts's authorization comment). `code` is the
 * plaintext recovery code and is returned exactly once, here; nothing
 * about it is persisted anywhere the client can read back later, so the
 * caller (a teacher-facing UI) is responsible for displaying/relaying it
 * to the student immediately.
 */
export const issueRecoveryCode = async (functions: Functions, input: IssueRecoveryCodeInput): Promise<IssueRecoveryCodeResult> => {
  const callable = httpsCallable<IssueRecoveryCodeInput, IssueRecoveryCodeResult>(functions, 'issueRecoveryCodeCallable')
  const result = await callable(input)
  return result.data
}

export interface RecoverParticipantInput {
  lessonRunId: string
  code: string
  idempotencyKey: string
}
export interface RecoverParticipantResult {
  participantId: string
  lessonRunId: string
  orgId: string
  teamId?: string
  oldAuthUid: string
  newAuthUid: string
  previousStatus: string
  sessionVersion: number
  membershipVersion: number
  deduplicated: boolean
}

/**
 * Client wrapper for the recoverParticipantCallable Callable. `newAuthUid`
 * is resolved server-side from the caller's verified auth token — the
 * client never sends or receives it as free-form input, matching
 * joinLessonRun.ts's authUid handling.
 */
export const recoverParticipant = async (functions: Functions, input: RecoverParticipantInput): Promise<RecoverParticipantResult> => {
  const callable = httpsCallable<RecoverParticipantInput, RecoverParticipantResult>(functions, 'recoverParticipantCallable')
  const result = await callable(input)
  return result.data
}

/**
 * UI-facing classification of why a recovery attempt failed. Mirrors
 * joinLessonRun.ts's `mapJoinLessonRunError` pattern: English literal
 * values the UI can switch on, kept separate from user-facing (Japanese)
 * message text.
 */
export type RecoveryErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED'
  | 'CODE_NOT_FOUND'
  | 'CODE_ALREADY_USED_OR_EXPIRED'
  /**
   * Distinct from CODE_ALREADY_USED_OR_EXPIRED: this means retrying
   * issueRecoveryCode with an idempotencyKey that already issued a code
   * failed, not that the (redeemed) recovery code itself is invalid. The
   * plaintext code was never persisted, so a retry cannot replay it — the
   * caller should treat this as "issue a brand-new code," not "the code you
   * have is dead." Maps from the Callable's `already-exists` error code
   * (participants/onCall.ts's translateRecoveryError).
   */
  | 'RECOVERY_CODE_ALREADY_ISSUED'
  | 'UNKNOWN'

interface FunctionsLikeError {
  code?: unknown
}

const FUNCTIONS_ERROR_CODE_MAP: Record<string, RecoveryErrorCode> = {
  'functions/unauthenticated': 'UNAUTHENTICATED',
  'functions/invalid-argument': 'INVALID_INPUT',
  'functions/permission-denied': 'PERMISSION_DENIED',
  'functions/not-found': 'CODE_NOT_FOUND',
  'functions/failed-precondition': 'CODE_ALREADY_USED_OR_EXPIRED',
  'functions/already-exists': 'RECOVERY_CODE_ALREADY_ISSUED',
}

/**
 * Maps a thrown `httpsCallable` error's `code` to a `RecoveryErrorCode` the
 * UI can switch on without depending on Firebase Functions' error-code
 * strings directly. Any unrecognized code (including a non-Functions
 * error, e.g. a network failure) maps to `'UNKNOWN'` rather than throwing.
 */
export const mapRecoveryError = (error: unknown): RecoveryErrorCode => {
  const code = (error as FunctionsLikeError | undefined)?.code
  if (typeof code === 'string' && code in FUNCTIONS_ERROR_CODE_MAP) {
    return FUNCTIONS_ERROR_CODE_MAP[code]
  }
  return 'UNKNOWN'
}
