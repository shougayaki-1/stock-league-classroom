import { randomBytes } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'

/**
 * KNOWN GAP (Important #3, task-3-report.md): `issueJoinCode`/`invalidateJoinCode`
 * are not currently reachable from anywhere except their own tests — neither
 * is exported as a Callable (see `onCall.ts`, which only wraps
 * `joinLessonRun`). This means the join flow does not yet close end-to-end:
 * `createLessonRun.ts` only ever creates a LessonRun with `status: 'DRAFT'`,
 * there is no DRAFT -> READY/WAITING transition implemented anywhere yet,
 * and `issueJoinCode`'s own gate (`JOINABLE_STATUSES` below) requires
 * READY/WAITING — so no real LessonRun in this codebase can have a join
 * code issued for it today. Fixing this is explicitly out of scope for this
 * task: a follow-up task needs to (1) add a Callable that lets a teacher
 * invoke `issueJoinCodeWithAdminSdk`/`invalidateJoinCodeWithAdminSdk`, and
 * (2) implement the lesson-run phase-transition machinery that moves a
 * LessonRun out of DRAFT.
 */

/**
 * Excludes 0/O/1/I to avoid characters students can confuse when copying a
 * code off a projector or whiteboard. Deliberately sized to exactly 32
 * (2^5) characters: 24 letters (A-Z minus I, O) + 8 digits (2-9). This lets
 * `generateRandomJoinCode` map each output character from 5 raw random bits
 * with zero modulo bias, instead of needing rejection sampling.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const DEFAULT_MAX_ATTEMPTS = 10

const JOINABLE_STATUSES = new Set(['READY', 'WAITING'])

interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface IssueJoinCodeDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  lessonRunId: string
  /** Injectable for tests. Production wiring uses `generateRandomJoinCode`. */
  generateCode: () => string
  /** Caps collision-retry attempts; NOT used as a PRNG seed (see note below). */
  maxAttempts?: number
  now?: () => unknown
}
export interface IssueJoinCodeResult { code: string }

/**
 * DESIGN NOTE — why this does not use the repo's deterministic PRNG:
 *
 * The Task 3 brief text said to generate join codes with
 * `@stock-league/deterministic-random` (mulberry32/deriveSeed), seeding on
 * lessonRunId + attempt, and to add the attempt number to the seed on
 * collision. That directly contradicts the package's own JSDoc, which
 * states mulberry32 "must never be used for tokens or join codes" — that
 * comment predates this task and encodes a deliberate Phase A security
 * decision: a join code's entire value is that it is *unguessable* by
 * someone not physically in the room, and a PRNG seeded from
 * public/predictable inputs (lessonRunId is visible in URLs; attempt is a
 * small integer) would let an attacker enumerate or predict codes.
 *
 * The coordinator confirmed this is an oversight in the Phase B plan text
 * and that the deterministic-random package's existing constraint takes
 * precedence (see task-3-report.md for the full exchange). So join codes
 * are generated with Node's `crypto.randomBytes`, not the deterministic
 * PRNG. `attempt`/`maxAttempts` still exist, but only as a cap on
 * collision retries (guarding against an infinite loop, not as a seed
 * input) — see `generateRandomJoinCode` below for how the alphabet was
 * sized to avoid modulo bias without needing rejection sampling.
 */
export const generateRandomJoinCode = (): string => {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    // ALPHABET.length === 32 === 2^5, so masking the low 5 bits of a
    // uniformly random byte yields a uniformly random alphabet index with no
    // modulo bias — no rejection sampling needed.
    code += ALPHABET[bytes[index] & 0x1f]
  }
  return code
}

/**
 * Validates `lessonRuns/{lessonRunId}` is READY or WAITING, then reserves a
 * unique `lessonJoinCodes/{code}` document inside a Firestore transaction.
 * On a collision with an existing (still-live) code, it regenerates and
 * retries up to `maxAttempts` times before giving up with an error.
 */
export const issueJoinCode = async (deps: IssueJoinCodeDeps): Promise<IssueJoinCodeResult> => {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const nowValue = deps.now ? deps.now() : new Date().toISOString()

  return deps.firestore.runTransaction(async (tx) => {
    const runSnap = await tx.get(`lessonRuns/${deps.lessonRunId}`)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const run = runSnap.data() as { status: string }
    if (!JOINABLE_STATUSES.has(run.status)) {
      throw new Error('LessonRun is not accepting join codes in its current status')
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const code = deps.generateCode()
      const existing = await tx.get(`lessonJoinCodes/${code}`)
      if (!existing.exists) {
        tx.set(`lessonJoinCodes/${code}`, {
          code,
          lessonRunId: deps.lessonRunId,
          status: 'ACTIVE',
          issuedAt: nowValue,
        })
        return { code }
      }
    }
    throw new Error('Unable to allocate a unique join code')
  })
}

export interface InvalidateJoinCodeDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  code: string
  now?: () => unknown
}

/**
 * Marks a join code as no longer usable (lesson ended, or the code expired).
 * Idempotent: invalidating an already-invalidated code is a no-op success,
 * not an error, so a retried "end lesson" flow does not fail on this step.
 */
export const invalidateJoinCode = async (deps: InvalidateJoinCodeDeps): Promise<void> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  await deps.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(`lessonJoinCodes/${deps.code}`)
    if (!snap.exists) throw new Error('Join code not found')
    const data = snap.data() as Record<string, unknown>
    if (data.status === 'INVALIDATED') return
    tx.set(`lessonJoinCodes/${deps.code}`, { ...data, status: 'INVALIDATED', invalidatedAt: nowValue })
  })
}

/** Production wiring: Firestore Admin SDK + crypto-random code generation. */
export const issueJoinCodeWithAdminSdk = (
  input: { lessonRunId: string; maxAttempts?: number },
): Promise<IssueJoinCodeResult> => {
  const db = getFirestore()
  return issueJoinCode({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    generateCode: generateRandomJoinCode,
    ...input,
  })
}

/** Production wiring: Firestore Admin SDK. */
export const invalidateJoinCodeWithAdminSdk = (input: { code: string }): Promise<void> => {
  const db = getFirestore()
  return invalidateJoinCode({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    ...input,
  })
}
