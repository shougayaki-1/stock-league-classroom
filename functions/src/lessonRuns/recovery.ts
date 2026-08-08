import { createHash, randomBytes } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId, ParticipantStatus, TeamId } from '@stock-league/lesson-runtime-types'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from './appendLessonEvent'
import { syncLessonRunMembershipWithAdminSdk } from './membershipMirror'
import type { LessonParticipant } from './participants/repository'

/**
 * Same alphabet as joinCodes.ts's ALPHABET (32 = 2^5 characters, excludes
 * 0/O/1/I) so a byte's low 5 bits map to an index with zero modulo bias —
 * see generateRandomJoinCode's JSDoc there for the full rationale. Length
 * is longer here (10 vs join codes' 6) because a recovery code is a
 * bearer secret that must survive being copied to a second device without
 * a teacher standing by to read it off a projector, so it trades a little
 * convenience for materially more entropy (2^50 vs 2^30 possibilities).
 */
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RECOVERY_CODE_LENGTH = 10

/**
 * DESIGN NOTE (matches joinCodes.ts): recovery codes are a security-bearing
 * secret, so — same as join codes — they are generated with Node's
 * `crypto.randomBytes`, never the repo's deterministic PRNG
 * (`@stock-league/deterministic-random`'s mulberry32 is explicitly
 * documented as forbidden for tokens/join codes; a recovery code is the
 * same category of secret).
 */
export const generateRandomRecoveryCode = (): string => {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH)
  let code = ''
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_CODE_ALPHABET[bytes[index] & 0x1f]
  }
  return code
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

export interface RecoveryFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  hashCode: (code: string) => string
  now?: () => unknown
  /** Separate from `now` (which may be a Firestore server-timestamp sentinel unusable for arithmetic) — a plain epoch-millis clock for expiry comparisons. */
  nowMillis?: () => number
}

export interface IssueRecoveryCodeDeps extends RecoveryFirestoreDeps {
  generateCode: () => string
  /** Defaults to 15 minutes — long enough for a student to switch devices, short enough to bound a leaked/overheard code's usable window. */
  expiresInMillis?: number
}
export interface IssueRecoveryCodeInput {
  lessonRunId: string
  participantId: ParticipantId
  idempotencyKey: string
}
export interface IssueRecoveryCodeResult {
  code: string
  deduplicated: false
}

const DEFAULT_EXPIRES_IN_MILLIS = 15 * 60 * 1000

/**
 * Generates a one-time recovery code and returns its plaintext to the
 * caller — the only moment the plaintext ever exists outside the
 * requester's memory. Firestore stores only `hashCode(code)` (SHA-256),
 * plus the code's expiry and used-state; the plaintext itself is never
 * persisted anywhere (verified directly in recovery.test.ts by scanning
 * every stored doc for the plaintext substring).
 *
 * Unlike every other idempotent flow in this codebase (join, checkpoint,
 * team assignment), a retried `idempotencyKey` here cannot replay the
 * original result: the original plaintext was never stored, so there is
 * nothing to hand back. A retry therefore fails loudly instead of silently
 * minting a second live code for the same logical request (which would
 * defeat idempotency's point) or silently succeeding with no code
 * returned (which would strand the caller). The idempotency doc itself
 * stores no secret — only the request digest and the issued code's hash —
 * so it is safe to keep even though it cannot be replayed.
 */
export const issueRecoveryCode = async (
  deps: IssueRecoveryCodeDeps,
  input: IssueRecoveryCodeInput,
): Promise<IssueRecoveryCodeResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  const expiresInMillis = deps.expiresInMillis ?? DEFAULT_EXPIRES_IN_MILLIS
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/recoveryIssueIdempotency/${idempotencyDocumentId(input.participantId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({ participantId: input.participantId })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as { requestDigest: string }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      throw new Error('Recovery code already issued for this idempotencyKey')
    }

    const participantPath = `lessonRuns/${input.lessonRunId}/participants/${input.participantId}`
    const participantSnap = await tx.get(participantPath)
    if (!participantSnap.exists) throw new Error('Participant not found')
    const participant = participantSnap.data() as unknown as LessonParticipant

    // ---- WRITE PHASE ----
    const code = deps.generateCode()
    const codeHash = deps.hashCode(code)
    const expiresAtMillis = nowMillisValue + expiresInMillis
    tx.set(`lessonRuns/${input.lessonRunId}/recoveryCodes/${codeHash}`, {
      participantId: input.participantId,
      lessonRunId: input.lessonRunId,
      orgId: participant.orgId,
      status: 'ACTIVE',
      issuedAt: nowValue,
      expiresAtMillis,
      usedAt: null,
    })
    tx.set(idempotencyPath, { requestDigest, codeHash, issuedAt: nowValue })

    return { code, deduplicated: false as const }
  })
}

export interface RecoverParticipantInput {
  lessonRunId: string
  code: string
  newAuthUid: string
  idempotencyKey: string
}
export interface RecoverParticipantResult {
  participantId: ParticipantId
  lessonRunId: string
  orgId: string
  teamId?: TeamId
  oldAuthUid: string
  newAuthUid: string
  previousStatus: ParticipantStatus
  sessionVersion: number
  membershipVersion: number
  deduplicated: boolean
}

/**
 * Redeems a one-time recovery code inside a single Firestore transaction:
 * (a) marks the code doc `USED` (dedup/reuse-prevention — a second redeem
 *     attempt, sequential or racing, sees the committed `USED` state and is
 *     rejected; Firestore's own transaction atomicity is what makes this
 *     safe under real concurrency, not any locking this function adds),
 * (b) re-points the participant's `authUid` from the old device to the
 *     new one,
 * (c) sets `status` to the transient `MIGRATING_DEVICE` value (restored to
 *     its pre-recovery value by `wireRecoverParticipant`'s `finalizeStatus`
 *     step, strictly after both RTDB mirrors below have been updated —
 *     see that function's JSDoc for why this final step lives outside this
 *     transaction),
 * (d) appends a `PARTICIPANT_RECOVERED` event via the shared
 *     `appendLessonEventInTransaction` helper.
 *
 * READ PHASE (all `tx.get`s, before any write — see joinLessonRun.ts's
 * JSDoc / task-3-report.md Critical #1 for why this ordering is
 * non-negotiable): idempotency doc, recovery-code doc, participant doc.
 * WRITE PHASE: `appendLessonEventInTransaction` first (its own internal
 * get-then-set must run before this function's own `tx.set` calls), then
 * the code doc, the participant doc, the authUid index docs, and finally
 * the idempotency doc.
 *
 * This function only performs the Firestore transaction — it does not
 * touch RTDB. `wireRecoverParticipant` below composes it with the
 * post-commit mirror updates and final status restore.
 */
export const recoverParticipant = async (
  deps: RecoveryFirestoreDeps,
  input: RecoverParticipantInput,
): Promise<RecoverParticipantResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/recoveryIdempotency/${idempotencyDocumentId(input.newAuthUid, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({ codeHash: deps.hashCode(input.code), newAuthUid: input.newAuthUid })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as { requestDigest: string; result: RecoverParticipantResult }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { ...prior.result, deduplicated: true }
    }

    const codeHash = deps.hashCode(input.code)
    const codePath = `lessonRuns/${input.lessonRunId}/recoveryCodes/${codeHash}`
    const codeSnap = await tx.get(codePath)
    if (!codeSnap.exists) throw new Error('Recovery code not found')
    const codeData = codeSnap.data() as {
      participantId: ParticipantId; orgId: string; status: string; expiresAtMillis: number
    }
    if (codeData.status !== 'ACTIVE') throw new Error('Recovery code has already been used')
    if (nowMillisValue > codeData.expiresAtMillis) throw new Error('Recovery code has expired')

    const participantPath = `lessonRuns/${input.lessonRunId}/participants/${codeData.participantId}`
    const participantSnap = await tx.get(participantPath)
    if (!participantSnap.exists) throw new Error('Participant not found')
    const participant = participantSnap.data() as unknown as LessonParticipant
    const oldAuthUid = participant.authUid
    const previousStatus = participant.status

    // ---- WRITE PHASE ----
    const event = await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId: participant.orgId,
      type: 'PARTICIPANT_RECOVERED',
      actorType: 'STUDENT',
      actorId: input.newAuthUid,
      payload: { participantId: participant.id, oldAuthUid, newAuthUid: input.newAuthUid },
      idempotencyKey: `${input.newAuthUid}:${input.idempotencyKey}`,
    }, nowValue)

    tx.set(codePath, { ...codeData, status: 'USED', usedAt: nowValue })
    tx.set(participantPath, { ...participant, authUid: input.newAuthUid, status: 'MIGRATING_DEVICE' })
    tx.set(`lessonRuns/${input.lessonRunId}/participantsByAuthUid/${input.newAuthUid}`, { participantId: participant.id })
    // Tombstone, not a delete (this FirestoreTx abstraction has no delete):
    // a rejoin attempt under the old authUid must not resurrect this
    // participant record via the old index entry.
    tx.set(`lessonRuns/${input.lessonRunId}/participantsByAuthUid/${oldAuthUid}`, {
      participantId: null, revokedForRecovery: true, recoveredTo: participant.id,
    })

    const result: RecoverParticipantResult = {
      participantId: participant.id,
      lessonRunId: input.lessonRunId,
      orgId: participant.orgId,
      ...(participant.teamId !== undefined ? { teamId: participant.teamId } : {}),
      oldAuthUid,
      newAuthUid: input.newAuthUid,
      previousStatus,
      sessionVersion: participant.sessionVersion,
      membershipVersion: event.sequence,
      deduplicated: false,
    }
    tx.set(idempotencyPath, { requestDigest, result })

    return result
  })
}

export interface WireRecoverParticipantDeps extends RecoveryFirestoreDeps {
  /** Called strictly after the Firestore transaction above has committed. Old UID first (REVOKED), then new UID (ACTIVE) — see the call site below for why that order matters. */
  syncMirror: (authUid: string, access: 'ACTIVE' | 'REVOKED', result: RecoverParticipantResult) => Promise<void>
  /** Called after both mirror writes resolve: restores the participant's Firestore `status` from the transient `MIGRATING_DEVICE` value back to whatever it was before recovery began. */
  finalizeStatus: (result: RecoverParticipantResult) => Promise<void>
}

/**
 * Composes `recoverParticipant`'s Firestore transaction with the RTDB
 * mirror updates and final status restore that must happen strictly after
 * it commits (Firestore commit must always precede RTDB writes — the same
 * rule joinLessonRun.ts follows). Ordering here is the load-bearing part:
 *
 *  1. `recoverParticipant` transaction commits (authUid moved, code
 *     consumed, event appended).
 *  2. Old UID's `lessonRunMembership` mirror entry is set to REVOKED.
 *  3. New UID's mirror entry is set to ACTIVE.
 *
 *  Steps 2-3 must not be reordered or parallelized: doing so would create a
 *  window where both the old and new UID simultaneously read as ACTIVE for
 *  the same participant, letting the old (should-be-abandoned) device keep
 *  operating during a device migration — exactly what Phase B's global
 *  constraint ("端末移行時は旧UIDを先にREVOKEDにし...") forbids.
 *
 *  4. Only once both mirrors are settled does `finalizeStatus` restore the
 *     participant's Firestore `status` from `MIGRATING_DEVICE` back to its
 *     pre-recovery value ("ミラー切替完了後に元状態へ戻す" per the task
 *     brief) — kept outside `recoverParticipant`'s own transaction because
 *     it depends on the mirror writes (step 2-3) having already happened,
 *     and Firestore transactions cannot depend on RTDB state observed
 *     mid-transaction.
 */
export const wireRecoverParticipant = (
  deps: WireRecoverParticipantDeps,
) => async (input: RecoverParticipantInput): Promise<RecoverParticipantResult> => {
  const { syncMirror, finalizeStatus, ...transactionDeps } = deps
  const result = await recoverParticipant(transactionDeps, input)
  await syncMirror(result.oldAuthUid, 'REVOKED', result)
  await syncMirror(result.newAuthUid, 'ACTIVE', result)
  await finalizeStatus(result)
  return result
}

/** Production wiring: Firestore Admin SDK transaction adapter, matching joinLessonRun.ts/checkpoint.ts. */
const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

export const issueRecoveryCodeWithAdminSdk = (
  input: IssueRecoveryCodeInput,
): Promise<IssueRecoveryCodeResult> =>
  issueRecoveryCode({
    firestore: adminSdkFirestore(),
    generateCode: generateRandomRecoveryCode,
    hashCode: sha256Hex,
    now: () => FieldValue.serverTimestamp(),
    nowMillis: () => Date.now(),
  }, input)

/**
 * Production wiring for `recoverParticipant`, via `wireRecoverParticipant`.
 * Only reachable through `recoverParticipantCallable` (see
 * participants/onCall.ts), which authorizes the caller before ever calling
 * this.
 */
export const recoverParticipantWithAdminSdk = (
  input: RecoverParticipantInput,
): Promise<RecoverParticipantResult> => {
  const db = getFirestore()
  const run = wireRecoverParticipant({
    firestore: adminSdkFirestore(),
    hashCode: sha256Hex,
    now: () => FieldValue.serverTimestamp(),
    nowMillis: () => Date.now(),
    syncMirror: async (authUid, access, result) => {
      // Both the old and new UID's participant record is, at this instant,
      // genuinely `MIGRATING_DEVICE` in Firestore (recoverParticipant's
      // transaction sets it before this runs) — that is the honest status
      // for both mirror writes. What differs between them is only `access`
      // (old UID must stop being trusted, new UID must start), which is
      // exactly what `accessOverride` (membershipMirror.ts) is for: it lets
      // this call force `mirror.access` to the caller's chosen value while
      // `mirror.participantStatus` still always reflects the real status.
      // (Previously this passed a fabricated `status: 'SUSPENDED'` for the
      // old UID to indirectly coerce `access` to REVOKED via
      // `activeParticipantStatuses` — that permanently wrote a false
      // participantStatus into RTDB; see task-4-report.md Critical #1.)
      await syncLessonRunMembershipWithAdminSdk({
        participant: {
          id: result.participantId,
          lessonRunId: result.lessonRunId,
          orgId: result.orgId,
          authUid,
          ...(result.teamId !== undefined ? { teamId: result.teamId } : {}),
          status: 'MIGRATING_DEVICE',
          sessionVersion: result.sessionVersion,
        },
        membershipVersion: result.membershipVersion,
        accessOverride: access,
      })
    },
    finalizeStatus: async (result) => {
      await db.doc(`lessonRuns/${result.lessonRunId}/participants/${result.participantId}`)
        .update({ status: result.previousStatus })
      // Re-sync the new-UID mirror once more so its `participantStatus`
      // field reflects the final (post-recovery) status instead of staying
      // at `MIGRATING_DEVICE` forever.
      await syncLessonRunMembershipWithAdminSdk({
        participant: {
          id: result.participantId,
          lessonRunId: result.lessonRunId,
          orgId: result.orgId,
          authUid: result.newAuthUid,
          ...(result.teamId !== undefined ? { teamId: result.teamId } : {}),
          status: result.previousStatus,
          sessionVersion: result.sessionVersion,
        },
        membershipVersion: result.membershipVersion,
      })
    },
  })
  return run(input)
}
