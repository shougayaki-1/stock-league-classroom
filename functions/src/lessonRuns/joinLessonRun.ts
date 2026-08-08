import { randomUUID } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId, ParticipantStatus, TeamId } from '@stock-league/lesson-runtime-types'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from './appendLessonEvent'
import type { LessonParticipant } from './participants/repository'
import { syncLessonRunMembershipWithAdminSdk } from './membershipMirror'

/**
 * Statuses that a reconnect (same authUid re-entering a join code) must
 * *preserve* rather than reset to ACTIVE.
 *
 *  - OBSERVER is a teacher-imposed demotion (e.g. a student caught
 *    misbehaving is dropped to view-only). If a rejoin silently promoted
 *    OBSERVER back to ACTIVE, that student could regain operate rights
 *    (`canParticipantOperate`) just by re-entering the join code, which
 *    would defeat the point of the demotion. So OBSERVER survives a
 *    reconnect unchanged.
 *  - SUSPENDED is not in this set because it is not "preserved" — it is
 *    rejected outright above (a suspended student cannot rejoin at all).
 *
 * Every other non-SUSPENDED status is a transient condition that a
 * successful reconnect inherently resolves, so it resets to ACTIVE:
 *  - TEMPORARILY_DISCONNECTED / MIGRATING_DEVICE / ABSENT describe *why*
 *    the participant was not currently present; reconnecting is exactly
 *    the event that ends that condition.
 *  - LATE_JOIN describes the *timing* of the participant's original join
 *    (they joined after the lesson started), not an ongoing restriction on
 *    what they can do — `canParticipantOperate` already treats LATE_JOIN
 *    the same as ACTIVE. By the time a rejoin happens the "late" framing no
 *    longer applies, so resetting to ACTIVE (rather than re-stamping
 *    LATE_JOIN) is correct here too.
 */
const STATUSES_PRESERVED_ON_RECONNECT: ReadonlySet<ParticipantStatus> = new Set(['OBSERVER'])

const JOINABLE_STATUSES = new Set(['READY', 'WAITING'])

export interface JoinLessonRunInput {
  joinCode: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  idempotencyKey: string
}

export interface JoinLessonRunResult {
  lessonRunId: string
  participantId: ParticipantId
  teamId?: TeamId
  duplicateIdentifierWarning: boolean
  deduplicated: boolean
}

/**
 * Loosely-typed sync callback so this pure module never needs to import
 * Admin SDK types (`Timestamp`/`FieldValue`) just to satisfy
 * `LessonParticipant`'s strict timestamp fields — those only matter to the
 * real RTDB mirror writer, which the AdminSdk wiring below constructs.
 */
export interface JoinLessonRunSyncMembershipInput {
  lessonRunId: string
  orgId: string
  authUid: string
  participantId: ParticipantId
  teamId?: TeamId
  status: ParticipantStatus
  sessionVersion: number
  membershipVersion: number
}

export interface JoinLessonRunDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  /** Resolved server-side from the caller's verified auth token — never client input. */
  authUid: string
  /** Opaque, non-replay-relevant ID. `crypto.randomUUID()` in production, matching createLessonRun's participantId-equivalent (lessonRunId) generation. */
  generateParticipantId: () => string
  /** Called strictly after the Firestore transaction commits successfully. */
  syncMembership: (input: JoinLessonRunSyncMembershipInput) => Promise<unknown>
  now?: () => unknown
}

/**
 * Joins a student/team-device into a lesson run identified by a join code.
 * Everything in steps (a)-(g) below happens inside one Firestore
 * transaction so a half-applied join (e.g. participant doc written but the
 * event not appended) can never be observed:
 *
 *  (a) idempotencyKey dedup, scoped by authUid (same pattern as
 *      createLessonRun's orgId-scoped dedup) — a retried request with the
 *      same key returns the original result with `deduplicated: true`
 *      instead of creating a second participant or a second event.
 *  (b) join-code lookup + ACTIVE check, then the target LessonRun's
 *      READY/WAITING status check.
 *  (c) maxParticipants check — LessonRun.maxParticipants is optional; no
 *      LessonRun schema in this codebase defines it yet (see
 *      task-3-report.md), so when absent the run is treated as unlimited.
 *      Only a *new* participant consumes a slot; a reconnecting authUid
 *      does not.
 *  (d) same-authUid same-lessonRun lookup via a
 *      `participantsByAuthUid/{authUid}` index doc (O(1) get, no query,
 *      matching this codebase's existing index-doc idiom for
 *      idempotency/eventIdempotency docs). If found, this is a reconnect:
 *      the existing participantId is reused, `sessionVersion` is
 *      incremented (invalidating any operation the student's *previous*
 *      tab/device tried to make with the old sessionVersion — the same
 *      global rule Phase A established for device migration). SUSPENDED is
 *      rejected outright (a suspended student cannot rejoin by retrying).
 *      Status otherwise resets to ACTIVE, *except* OBSERVER, which is a
 *      teacher-imposed demotion and is preserved across the reconnect (see
 *      `STATUSES_PRESERVED_ON_RECONNECT` below) — a rejoin must never be a
 *      way to silently regain operate rights after being demoted.
 *  (e) externalIdentifier soft-collision check: if another participant in
 *      this run already claims the same externalIdentifier (e.g. a
 *      student number), the join still succeeds but
 *      `duplicateIdentifierWarning: true` is returned so a teacher can
 *      spot a typo later — it is never a hard failure.
 *  (f) participant doc upsert at `lessonRuns/{lessonRunId}/participants/{participantId}`.
 *  (g) `PARTICIPANT_JOINED` event via the shared `appendLessonEventInTransaction`
 *      helper (Phase A) — never a bespoke re-implementation.
 *
 * `syncMembership` (the RTDB mirror) is called only after this transaction
 * resolves, never inside it — Firestore commit must precede any RTDB
 * write. It runs on every successful call, including deduplicated
 * replays: the mirror write is a full-replace `set()` (idempotent), so
 * replaying it is always safe, and doing so heals a mirror that could have
 * been left stale by a prior attempt that committed Firestore but crashed
 * before the RTDB write completed.
 */
export const joinLessonRun = async (
  deps: JoinLessonRunDeps,
  input: JoinLessonRunInput,
): Promise<JoinLessonRunResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const idempotencyPath = `lessonJoinIdempotency/${idempotencyDocumentId(deps.authUid, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({
    authUid: deps.authUid,
    joinCode: input.joinCode,
    identityMode: input.identityMode,
    displayName: input.displayName,
    externalIdentifier: input.externalIdentifier ?? null,
  })

  const outcome = await deps.firestore.runTransaction(async (tx): Promise<{
    result: JoinLessonRunResult
    membershipVersion: number
    orgId: string
    teamId?: TeamId
    status: ParticipantStatus
    sessionVersion: number
  }> => {
    // ---- READ PHASE ----
    // Firestore Admin SDK transactions require every `tx.get` to happen
    // before any `tx.set`/`tx.update` in the same transaction (violating
    // this always throws in production — see task-3-report.md's Critical #1
    // writeup). Every read this function needs, across every branch, is
    // gathered here into local variables before the WRITE PHASE below
    // performs a single `tx.set` (or the `appendLessonEventInTransaction`
    // call, itself get-then-set) begins.
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as {
        requestDigest: string
        result: JoinLessonRunResult
        orgId: string
        membershipVersion: number
        sessionVersion: number
        status?: ParticipantStatus
      }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      // Pure dedup replay: no write of any kind happens on this path, so it
      // is safe to return directly without reaching the write phase at all.
      // `prior.status` falls back to ACTIVE only for idempotency docs
      // written before this field existed; every doc written by the
      // current WRITE PHASE below always includes it.
      return {
        result: { ...prior.result, deduplicated: true },
        membershipVersion: prior.membershipVersion,
        orgId: prior.orgId,
        teamId: prior.result.teamId,
        status: prior.status ?? 'ACTIVE',
        sessionVersion: prior.sessionVersion,
      }
    }

    const codeSnap = await tx.get(`lessonJoinCodes/${input.joinCode}`)
    if (!codeSnap.exists) throw new Error('Join code not found')
    const codeData = codeSnap.data() as { lessonRunId: string; status: string }
    if (codeData.status !== 'ACTIVE') throw new Error('Join code is not active')
    const lessonRunId = codeData.lessonRunId

    const runSnap = await tx.get(`lessonRuns/${lessonRunId}`)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const run = runSnap.data() as { orgId: string; status: string; maxParticipants?: number }
    if (!JOINABLE_STATUSES.has(run.status)) throw new Error('LessonRun is not accepting participants')

    const authIndexPath = `lessonRuns/${lessonRunId}/participantsByAuthUid/${deps.authUid}`
    const authIndexSnap = await tx.get(authIndexPath)

    let participantId: ParticipantId
    let teamId: TeamId | undefined
    let sessionVersion: number
    let joinedAt: unknown
    let isNewParticipant: boolean
    let newStatus: ParticipantStatus
    // Only meaningful when a brand-new participant is being created under a
    // maxParticipants cap: the counter value read now, to be written (+1)
    // in the write phase below. `undefined` means "no counter write needed"
    // (either maxParticipants is unset, or this is a reconnect that must
    // not consume a new slot).
    let counterValueToPersist: number | undefined

    if (authIndexSnap.exists) {
      const { participantId: existingParticipantId } = authIndexSnap.data() as { participantId: ParticipantId }
      const existingSnap = await tx.get(`lessonRuns/${lessonRunId}/participants/${existingParticipantId}`)
      if (!existingSnap.exists) throw new Error('Participant index is inconsistent')
      const existing = existingSnap.data() as unknown as LessonParticipant
      if (existing.status === 'SUSPENDED') throw new Error('Participant has been suspended from this lesson')
      participantId = existingParticipantId
      teamId = existing.teamId
      sessionVersion = existing.sessionVersion + 1
      joinedAt = existing.joinedAt
      isNewParticipant = false
      // See STATUSES_PRESERVED_ON_RECONNECT's JSDoc above for why only
      // OBSERVER survives a reconnect unchanged.
      newStatus = STATUSES_PRESERVED_ON_RECONNECT.has(existing.status) ? existing.status : 'ACTIVE'
    } else {
      if (typeof run.maxParticipants === 'number') {
        const counterSnap = await tx.get(`lessonRuns/${lessonRunId}/meta/participantCounter`)
        const currentCount = counterSnap.exists ? (counterSnap.data() as { value: number }).value : 0
        if (currentCount >= run.maxParticipants) {
          throw new Error('LessonRun has reached its maximum number of participants')
        }
        counterValueToPersist = currentCount + 1
      }
      participantId = deps.generateParticipantId()
      teamId = undefined
      sessionVersion = 0
      joinedAt = nowValue
      isNewParticipant = true
      newStatus = 'ACTIVE'
    }

    let duplicateIdentifierWarning = false
    let identifierIndexPath: string | undefined
    let shouldWriteIdentifierIndex = false
    if (input.externalIdentifier) {
      identifierIndexPath =
        `lessonRuns/${lessonRunId}/participantsByExternalIdentifier/${idempotencyDocumentId(lessonRunId, input.externalIdentifier)}`
      const identifierSnap = await tx.get(identifierIndexPath)
      if (identifierSnap.exists) {
        const { participantId: ownerParticipantId } = identifierSnap.data() as { participantId: ParticipantId }
        if (ownerParticipantId !== participantId) duplicateIdentifierWarning = true
      } else {
        shouldWriteIdentifierIndex = true
      }
    }

    // ---- WRITE PHASE ----
    // `appendLessonEventInTransaction` must be invoked first, before any of
    // this function's own `tx.set` calls: it performs its own `tx.get`s
    // internally (idempotency + counter lookups) before its own `tx.set`s.
    // Placed here — after every read above, before every write below — its
    // internal gets are still legal (nothing in this transaction has
    // written yet), and its internal sets become the transaction's first
    // writes. See task-3-report.md Critical #1 for why the old
    // participant-doc-then-event ordering always threw in production.
    //
    // The idempotencyKey passed here is scoped by authUid (Important #1):
    // appendLessonEventInTransaction scopes its own dedup doc by
    // `lessonRunId` only, so two different students submitting the same
    // client-generated idempotencyKey (e.g. both send "join-1") would
    // otherwise collide on the *same* eventIdempotency doc and the second
    // student would hit "Idempotency key payload mismatch" merely because
    // their payload (authUid, participantId, ...) differs from the first's.
    // Prefixing with authUid keeps this scoped exactly like the outer join
    // idempotency doc (`idempotencyDocumentId(deps.authUid, ...)` above).
    const event = await appendLessonEventInTransaction(tx, {
      lessonRunId,
      orgId: run.orgId,
      type: 'PARTICIPANT_JOINED',
      actorType: 'STUDENT',
      actorId: deps.authUid,
      payload: { participantId, identityMode: input.identityMode, teamId: teamId ?? null },
      idempotencyKey: `${deps.authUid}:${input.idempotencyKey}`,
    }, nowValue)

    // The event's own monotonically-increasing per-lessonRun sequence
    // number doubles as the RTDB mirror's membershipVersion — it is already
    // a causally-ordered counter, so there is no need to invent a second
    // counter just for this (currently rule-inert, see
    // LessonRunMembershipMirror's JSDoc) field.
    const membershipVersion = event.sequence

    if (counterValueToPersist !== undefined) {
      tx.set(`lessonRuns/${lessonRunId}/meta/participantCounter`, { value: counterValueToPersist })
    }

    const participant: LessonParticipant = {
      id: participantId,
      lessonRunId,
      orgId: run.orgId,
      authUid: deps.authUid,
      identityMode: input.identityMode,
      displayName: input.displayName,
      ...(input.externalIdentifier !== undefined ? { externalIdentifier: input.externalIdentifier } : {}),
      ...(teamId !== undefined ? { teamId } : {}),
      status: newStatus,
      sessionVersion,
      joinedAt: joinedAt as LessonParticipant['joinedAt'],
      lastSeenAt: nowValue as LessonParticipant['lastSeenAt'],
    }
    tx.set(`lessonRuns/${lessonRunId}/participants/${participantId}`, { ...participant })
    if (isNewParticipant) {
      tx.set(authIndexPath, { participantId })
    }
    if (shouldWriteIdentifierIndex && identifierIndexPath) {
      tx.set(identifierIndexPath, { participantId })
    }

    const result: JoinLessonRunResult = {
      lessonRunId,
      participantId,
      ...(teamId !== undefined ? { teamId } : {}),
      duplicateIdentifierWarning,
      deduplicated: false,
    }
    tx.set(idempotencyPath, { requestDigest, result, orgId: run.orgId, membershipVersion, sessionVersion, status: newStatus })

    return { result, membershipVersion, orgId: run.orgId, teamId, status: newStatus, sessionVersion }
  })

  await deps.syncMembership({
    lessonRunId: outcome.result.lessonRunId,
    orgId: outcome.orgId,
    authUid: deps.authUid,
    participantId: outcome.result.participantId,
    ...(outcome.teamId !== undefined ? { teamId: outcome.teamId } : {}),
    status: outcome.status,
    sessionVersion: outcome.sessionVersion,
    membershipVersion: outcome.membershipVersion,
  })

  return outcome.result
}

/** Production wiring: Firestore Admin SDK transaction + RTDB mirror sync. */
export const joinLessonRunWithAdminSdk = (
  input: JoinLessonRunInput & { authUid: string },
): Promise<JoinLessonRunResult> => {
  const db = getFirestore()
  const { authUid, ...rest } = input
  return joinLessonRun({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    authUid,
    generateParticipantId: randomUUID,
    // A real Firestore server timestamp, not a client-clock ISO string —
    // matches createLessonRun's/writeCheckpoint's admin-sdk-layer use of
    // FieldValue.serverTimestamp() for persisted timestamp fields. Read
    // back on rejoin as an already-resolved Timestamp, so joinedAt is
    // never overwritten by a later reconnect.
    now: () => FieldValue.serverTimestamp(),
    // Uses the values already computed and validated inside the Firestore
    // transaction above (`syncInput`) directly, rather than re-reading the
    // participant doc from Firestore here. The transaction already
    // determined the authoritative orgId/authUid/teamId/status/
    // sessionVersion for this request — re-reading would not just be a
    // redundant extra Firestore round-trip, it would also risk mirroring a
    // value that changed between the transaction's commit and this read
    // (e.g. a teacher-issued status change racing this call), instead of
    // the value this specific join actually produced.
    syncMembership: async (syncInput) => syncLessonRunMembershipWithAdminSdk({
      participant: {
        id: syncInput.participantId,
        lessonRunId: syncInput.lessonRunId,
        orgId: syncInput.orgId,
        authUid: syncInput.authUid,
        teamId: syncInput.teamId,
        status: syncInput.status,
        sessionVersion: syncInput.sessionVersion,
      },
      membershipVersion: syncInput.membershipVersion,
    }),
  }, rest)
}
