import { httpsCallable, type Functions } from 'firebase/functions'

export interface JoinLessonRunInput {
  joinCode: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  idempotencyKey: string
}

export interface JoinLessonRunResult {
  lessonRunId: string
  participantId: string
  teamId?: string
  duplicateIdentifierWarning: boolean
  deduplicated: boolean
}

/**
 * Client wrapper for the joinLessonRunCallable Callable. `authUid` is
 * resolved server-side from the caller's auth token and is never sent by or
 * returned to the client, matching restoreCheckpoint/createLessonRun.
 */
export const joinLessonRun = async (functions: Functions, input: JoinLessonRunInput): Promise<JoinLessonRunResult> => {
  const callable = httpsCallable<JoinLessonRunInput, JoinLessonRunResult>(functions, 'joinLessonRunCallable')
  const result = await callable(input)
  return result.data
}

/**
 * UI-facing classification of why a join attempt failed. Kept separate from
 * the (Japanese) message text a UI component would show — this task only
 * produces the classification layer, per the Task 3 brief's scope. Values
 * are English literals (matching this codebase's convention of English
 * enum/type names with Japanese-only user-facing strings, see
 * organizations/authorization.ts's ActiveMembership role names for
 * precedent).
 */
export type JoinLessonErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'JOIN_CODE_NOT_FOUND'
  | 'LESSON_NOT_ACCEPTING_PARTICIPANTS'
  | 'LESSON_FULL'
  | 'PARTICIPANT_SUSPENDED'
  | 'UNKNOWN'

interface FunctionsLikeError {
  code?: unknown
}

const FUNCTIONS_ERROR_CODE_MAP: Record<string, JoinLessonErrorCode> = {
  'functions/unauthenticated': 'UNAUTHENTICATED',
  'functions/invalid-argument': 'INVALID_INPUT',
  'functions/not-found': 'JOIN_CODE_NOT_FOUND',
  'functions/failed-precondition': 'LESSON_NOT_ACCEPTING_PARTICIPANTS',
  'functions/resource-exhausted': 'LESSON_FULL',
  'functions/permission-denied': 'PARTICIPANT_SUSPENDED',
}

/**
 * Maps a thrown `httpsCallable` error's `code` (a `FunctionsErrorCode`, e.g.
 * `"functions/not-found"`) to a `JoinLessonErrorCode` the UI can switch on
 * without depending on Firebase Functions' error-code strings directly.
 * Any code this map does not recognize (including a non-Functions error,
 * e.g. a network failure) maps to `'UNKNOWN'` rather than throwing.
 */
export const mapJoinLessonRunError = (error: unknown): JoinLessonErrorCode => {
  const code = (error as FunctionsLikeError | undefined)?.code
  if (typeof code === 'string' && code in FUNCTIONS_ERROR_CODE_MAP) {
    return FUNCTIONS_ERROR_CODE_MAP[code]
  }
  return 'UNKNOWN'
}
