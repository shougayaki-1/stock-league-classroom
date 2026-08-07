import { httpsCallable, type Functions } from 'firebase/functions'
import { signInWithCustomToken, type Auth, type UserCredential } from 'firebase/auth'

export interface IssueDisplaySessionTokenInput {
  lessonRunId: string
}
export interface IssueDisplaySessionTokenResult {
  /** Plaintext one-time token, returned exactly once (see functions/src/lessonRuns/projections/displaySession.ts). The caller (a teacher-facing UI) is responsible for embedding it into the classroom-display URL/QR immediately — nothing about it is persisted anywhere the client can read back later. */
  token: string
}

/**
 * Client wrapper for issueDisplaySessionTokenCallable (teacher-only —
 * PRIMARY/ASSISTANT role on the run, see projections/onCall.ts). Mirrors
 * lifecycle.ts / recovery.ts's thin-Callable-wrapper pattern: no logic here
 * beyond shaping the request/response, all authorization happens
 * server-side.
 */
export const issueDisplaySessionToken = async (
  functions: Functions,
  input: IssueDisplaySessionTokenInput,
): Promise<IssueDisplaySessionTokenResult> => {
  const callable = httpsCallable<IssueDisplaySessionTokenInput, IssueDisplaySessionTokenResult>(functions, 'issueDisplaySessionTokenCallable')
  const result = await callable(input)
  return result.data
}

export interface ExchangeDisplaySessionTokenInput {
  lessonRunId: string
  token: string
}
export interface ExchangeDisplaySessionTokenResult {
  customToken: string
}

/**
 * Client wrapper for exchangeDisplaySessionTokenCallable. Deliberately
 * unauthenticated on the wire (see onCall.ts's JSDoc) — the classroom
 * screen has no signed-in user yet, and possessing the plaintext `token`
 * (delivered only via the projector URL) is itself the credential.
 */
export const exchangeDisplaySessionToken = async (
  functions: Functions,
  input: ExchangeDisplaySessionTokenInput,
): Promise<ExchangeDisplaySessionTokenResult> => {
  const callable = httpsCallable<ExchangeDisplaySessionTokenInput, ExchangeDisplaySessionTokenResult>(functions, 'exchangeDisplaySessionTokenCallable')
  const result = await callable(input)
  return result.data
}

/**
 * The full classroom-display bootstrap (this task's brief Step 4), wrapped
 * as a single call so `ClassroomDisplayPage` stays a thin shell: exchanges
 * the plaintext `token` embedded in the display URL for a Firebase custom
 * token via `exchangeDisplaySessionTokenCallable`, then signs the display
 * device in with `signInWithCustomToken`. The resulting session's ID-token
 * claims carry ONLY `displayRunId` (minted server-side — see
 * projections/displaySession.ts's `exchangeDisplaySessionToken`), which is
 * exactly what `database.rules.json`'s `lessonRunDisplay/{lessonRunId}`
 * rule checks against; no teacher identity, role, or other claim is ever
 * placed on this session.
 *
 * `token` and `lessonRunId` are expected to come from the display URL's
 * query string, never from a teacher's own auth/session state — the caller
 * (ClassroomDisplayPage) must not read or forward any teacher credential
 * here.
 */
export const signInForClassroomDisplay = async (
  auth: Auth,
  functions: Functions,
  input: ExchangeDisplaySessionTokenInput,
): Promise<UserCredential> => {
  const { customToken } = await exchangeDisplaySessionToken(functions, input)
  return signInWithCustomToken(auth, customToken)
}
