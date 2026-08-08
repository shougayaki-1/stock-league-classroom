import { createHash, randomBytes } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import type { FirestoreTx } from '../appendLessonEvent'

/**
 * Classroom-display session tokens (Step 3, this task's brief): a
 * projector/classroom-screen URL embeds this token to identify which
 * lessonRun to display, WITHOUT ever signing the viewer in as a real user.
 *
 * DESIGN — same shape as recovery.ts's recovery codes / joinCodes.ts's join
 * codes, deliberately NOT the deterministic PRNG
 * (`@stock-league/deterministic-random` is documented as forbidden for
 * tokens/join codes — see joinCodes.ts's DESIGN NOTE): this token is a
 * bearer secret gating a Firebase custom-token mint, so it must be
 * cryptographically unguessable. Unlike a 6-character join code (meant to
 * be typed by a student off a projector) this token is meant to be embedded
 * directly in a URL and never typed by a human, so it is sized far larger
 * (32 random bytes / 256 bits, hex-encoded to 64 characters) purely for
 * entropy, with no alphabet-collision-avoidance tradeoff to make.
 */
export const generateDisplaySessionToken = (): string => randomBytes(32).toString('hex')

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

export interface DisplaySessionFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  hashToken: (token: string) => string
  now?: () => unknown
  nowMillis?: () => number
}

export interface IssueDisplaySessionTokenDeps extends DisplaySessionFirestoreDeps {
  generateToken: () => string
  /**
   * TENTATIVE DEFAULT (not yet validated against real classroom-setup
   * timing — matches this repo's established pattern of picking a
   * placeholder value and revisiting it after a trial run, e.g. Phase C's
   * plan docs): 2 hours. Long enough for a teacher to project the URL well
   * before class starts and still have it valid at lesson time, short
   * enough to bound a leaked/screenshotted URL's usable window before the
   * one-time exchange below permanently consumes it anyway.
   */
  expiresInMillis?: number
}
export interface IssueDisplaySessionTokenInput { lessonRunId: string; orgId: string }
export interface IssueDisplaySessionTokenResult { token: string }

const DEFAULT_EXPIRES_IN_MILLIS = 2 * 60 * 60 * 1000

/**
 * Generates a one-time classroom-display session token and returns its
 * plaintext to the caller (a teacher-authorized Callable — see onCall.ts)
 * — the only moment the plaintext ever exists outside that response.
 * Firestore's session system of record
 * (`lessonRuns/{lessonRunId}/displaySessions/{sha256(token)}`) stores only
 * the hash, exactly matching recovery.ts's `issueRecoveryCode` pattern; the
 * plaintext token itself is never persisted anywhere.
 */
export const issueDisplaySessionToken = async (
  deps: IssueDisplaySessionTokenDeps,
  input: IssueDisplaySessionTokenInput,
): Promise<IssueDisplaySessionTokenResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  const expiresInMillis = deps.expiresInMillis ?? DEFAULT_EXPIRES_IN_MILLIS

  return deps.firestore.runTransaction(async (tx) => {
    const token = deps.generateToken()
    const tokenHash = deps.hashToken(token)
    tx.set(`lessonRuns/${input.lessonRunId}/displaySessions/${tokenHash}`, {
      lessonRunId: input.lessonRunId,
      orgId: input.orgId,
      status: 'ACTIVE',
      issuedAt: nowValue,
      expiresAtMillis: nowMillisValue + expiresInMillis,
      exchangedAt: null,
    })
    return { token }
  })
}

export interface ExchangeDisplaySessionTokenInput { lessonRunId: string; token: string }
export interface ExchangeDisplaySessionTokenResult {
  lessonRunId: string
  /**
   * Synthetic Firebase Auth uid for the custom token, deterministic per
   * lessonRunId (not per-token) — the security boundary here is entirely
   * "did the caller possess the one-time secret token", not "is this uid a
   * secret". A deterministic uid means all display sessions for the same
   * run resolve to one Auth user record, which a future lesson-end/archive
   * step can disable/delete to revoke any still-signed-in projector session
   * (Firebase custom-token sign-ins otherwise persist via the client SDK's
   * normal refresh-token flow, independent of this token's one-time use).
   */
  uid: string
  claims: { displayRunId: string }
}

/**
 * Redeems a one-time display-session token: verifies it exists, is
 * `ACTIVE`, and has not expired, then marks it `USED` inside the same
 * Firestore transaction (idempotency/replay-prevention identical in shape
 * to recovery.ts's `recoverParticipant` marking its code doc `USED`) and
 * returns the `(uid, claims)` pair the caller mints a Firebase custom token
 * from via `admin.auth().createCustomToken` — see
 * `exchangeDisplaySessionTokenWithAdminSdk` below, which is the only place
 * `createCustomToken` is actually called (kept out of this pure function so
 * it stays unit-testable without the Admin SDK).
 *
 * The token is looked up by `lessonRunId + hash(token)` together (not hash
 * alone), so a token issued for one run can never be exchanged against a
 * different run's path even if guessed/reused.
 */
export const exchangeDisplaySessionToken = async (
  deps: DisplaySessionFirestoreDeps,
  input: ExchangeDisplaySessionTokenInput,
): Promise<ExchangeDisplaySessionTokenResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  const tokenHash = deps.hashToken(input.token)
  const sessionPath = `lessonRuns/${input.lessonRunId}/displaySessions/${tokenHash}`

  return deps.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(sessionPath)
    if (!snap.exists) throw new Error('Display session token not found')
    const session = snap.data() as { lessonRunId: string; status: string; expiresAtMillis: number }
    if (session.lessonRunId !== input.lessonRunId) throw new Error('Display session token not found')
    if (session.status !== 'ACTIVE') throw new Error('Display session token has already been used')
    if (nowMillisValue > session.expiresAtMillis) throw new Error('Display session token has expired')

    tx.set(sessionPath, { ...session, status: 'USED', exchangedAt: nowValue })

    return {
      lessonRunId: input.lessonRunId,
      uid: `display-${input.lessonRunId}`,
      claims: { displayRunId: input.lessonRunId },
    }
  })
}

const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

/** Production wiring: Firestore Admin SDK transaction adapter, matching recovery.ts. */
export const issueDisplaySessionTokenWithAdminSdk = (
  input: IssueDisplaySessionTokenInput,
): Promise<IssueDisplaySessionTokenResult> =>
  issueDisplaySessionToken({
    firestore: adminSdkFirestore(),
    generateToken: generateDisplaySessionToken,
    hashToken: sha256Hex,
    now: () => new Date().toISOString(),
    nowMillis: () => Date.now(),
  }, input)

/**
 * Production wiring: redeems the token via `exchangeDisplaySessionToken`
 * (Firestore transaction), then — strictly after that transaction commits —
 * mints the Firebase custom token via `admin.auth().createCustomToken`.
 * This is the only place in the codebase that calls `createCustomToken` for
 * a display session; only reachable through
 * `exchangeDisplaySessionTokenCallable` (see onCall.ts), which is
 * deliberately public/unauthenticated (the projector has no signed-in user
 * yet) — the token itself, not caller auth, is the credential here.
 */
export const exchangeDisplaySessionTokenWithAdminSdk = async (
  input: ExchangeDisplaySessionTokenInput,
): Promise<{ customToken: string }> => {
  const result = await exchangeDisplaySessionToken({
    firestore: adminSdkFirestore(),
    hashToken: sha256Hex,
    now: () => new Date().toISOString(),
    nowMillis: () => Date.now(),
  }, input)
  const customToken = await getAuth().createCustomToken(result.uid, result.claims)
  return { customToken }
}
