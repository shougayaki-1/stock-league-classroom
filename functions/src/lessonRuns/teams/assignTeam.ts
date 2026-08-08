import { getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId, TeamId } from '@stock-league/lesson-runtime-types'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from '../appendLessonEvent'
import type { LessonParticipant } from '../participants/repository'
import type { LessonTeam } from './repository'
import { assignBalancedTeam } from './repository'

export interface TeamFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  actorId: string
  /** Defaults to 'TEACHER' (assignParticipantToTeam is teacher-only; rotateRepresentative accepts 'SYSTEM' too, for a future automatic-rotation caller). */
  actorType?: 'TEACHER' | 'SYSTEM'
  now?: () => unknown
}

export interface AssignParticipantToTeamInput {
  lessonRunId: string
  participantId: ParticipantId
  idempotencyKey: string
}
export interface AssignParticipantToTeamResult {
  teamId: TeamId
  version: number
  deduplicated: boolean
}

/**
 * Assigns an unassigned participant to whichever team currently has the
 * fewest members (`assignBalancedTeam`, repository.ts), inside a single
 * Firestore transaction so the team roster, the participant's `teamId`,
 * and the `TEAM_MEMBER_ASSIGNED` audit event are never observed
 * half-applied.
 *
 * The set of teams to balance across is read from
 * `lessonRuns/{lessonRunId}/meta/teamsIndex` (`{ teamIds: TeamId[] }`) — a
 * small index doc, not a live Firestore query, because this codebase's
 * `FirestoreTx` abstraction (appendLessonEvent.ts) only supports get/set by
 * path, matching every other transactional flow in lessonRuns/ (e.g.
 * joinLessonRun.ts's `participantsByAuthUid` index doc). Team creation is
 * out of this task's scope; the index doc is assumed to already exist by
 * the time assignment runs.
 *
 * READ PHASE (must complete before any write, see task-3-report.md Critical
 * #1): idempotency doc, participant doc, teamsIndex doc, then every team
 * doc named in the index. WRITE PHASE: `appendLessonEventInTransaction`
 * first (it performs its own get-then-set internally, so it must run
 * before this function's own `tx.set` calls), then the chosen team doc,
 * the participant doc, and finally the idempotency doc.
 */
export const assignParticipantToTeam = async (
  deps: TeamFirestoreDeps,
  input: AssignParticipantToTeamInput,
): Promise<AssignParticipantToTeamResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/assignTeamIdempotency/${idempotencyDocumentId(input.participantId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({ participantId: input.participantId })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as { requestDigest: string; teamId: TeamId; version: number }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { teamId: prior.teamId, version: prior.version, deduplicated: true }
    }

    const participantPath = `lessonRuns/${input.lessonRunId}/participants/${input.participantId}`
    const participantSnap = await tx.get(participantPath)
    if (!participantSnap.exists) throw new Error('Participant not found')
    const participant = participantSnap.data() as unknown as LessonParticipant
    if (participant.teamId) throw new Error('Participant is already assigned to a team')

    const indexSnap = await tx.get(`lessonRuns/${input.lessonRunId}/meta/teamsIndex`)
    if (!indexSnap.exists) throw new Error('No teams available for assignment')
    const { teamIds } = indexSnap.data() as { teamIds: TeamId[] }
    if (!teamIds || teamIds.length === 0) throw new Error('No teams available for assignment')

    const teamPaths = teamIds.map((teamId) => `lessonRuns/${input.lessonRunId}/teams/${teamId}`)
    const teamSnaps = await Promise.all(teamPaths.map((path) => tx.get(path)))
    const teams = teamSnaps.map((snap, index) => {
      if (!snap.exists) throw new Error(`Team not found: ${teamIds[index]}`)
      return snap.data() as unknown as LessonTeam
    })

    // ---- WRITE PHASE ----
    const chosenTeamId = assignBalancedTeam(teams.map((team) => ({ id: team.id, size: team.memberParticipantIds.length })))
    const chosenTeam = teams.find((team) => team.id === chosenTeamId)
    if (!chosenTeam) throw new Error('Selected team could not be resolved')

    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId: participant.orgId,
      type: 'TEAM_MEMBER_ASSIGNED',
      actorType: 'TEACHER',
      actorId: deps.actorId,
      payload: { participantId: input.participantId, teamId: chosenTeamId },
      idempotencyKey: `${input.participantId}:${input.idempotencyKey}`,
    }, nowValue)

    const newVersion = chosenTeam.version + 1
    tx.set(`lessonRuns/${input.lessonRunId}/teams/${chosenTeamId}`, {
      ...chosenTeam,
      memberParticipantIds: [...chosenTeam.memberParticipantIds, input.participantId],
      version: newVersion,
    })
    tx.set(participantPath, { ...participant, teamId: chosenTeamId })
    tx.set(idempotencyPath, { requestDigest, teamId: chosenTeamId, version: newVersion })

    return { teamId: chosenTeamId, version: newVersion, deduplicated: false }
  })
}

export interface RotateRepresentativeInput {
  lessonRunId: string
  teamId: TeamId
  newRepresentativeParticipantId: ParticipantId
  /** Why the rotation happened — e.g. "手動交代" (manual, teacher/student-initiated) or "代表者の接続断による自動昇格" (automatic, triggered by a future disconnect-handling task). Recorded verbatim on the TEAM_REPRESENTATIVE_CHANGED event; this function itself is agnostic to what triggered the call. */
  reason: string
  idempotencyKey: string
  /** Optional optimistic-concurrency guard: if provided and it does not match the team's current `version`, the rotation is rejected rather than silently overwriting a change the caller has not seen. */
  expectedVersion?: number
}
export interface RotateRepresentativeResult {
  teamId: TeamId
  previousRepresentativeParticipantId?: ParticipantId
  newRepresentativeParticipantId: ParticipantId
  version: number
  deduplicated: boolean
}

/**
 * Generic representative-rotation primitive: it takes a `reason` string and
 * has no opinion on whether the caller is a manual teacher/student action
 * or a future automatic-rotation trigger (e.g. representative disconnect
 * handling, explicitly out of this task's scope) — both call this the same
 * way. Records `TEAM_REPRESENTATIVE_CHANGED` with the before/after
 * representative and the reason via `appendLessonEventInTransaction`.
 *
 * Same read-before-write discipline as assignParticipantToTeam above:
 * idempotency doc and team doc are both read before any write; the event
 * append (itself get-then-set) runs first among the writes.
 */
export const rotateRepresentative = async (
  deps: TeamFirestoreDeps,
  input: RotateRepresentativeInput,
): Promise<RotateRepresentativeResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/teams/${input.teamId}/rotateRepresentativeIdempotency/${idempotencyDocumentId(input.teamId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({
    newRepresentativeParticipantId: input.newRepresentativeParticipantId,
    reason: input.reason,
    expectedVersion: input.expectedVersion ?? null,
  })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as {
        requestDigest: string
        previousRepresentativeParticipantId?: ParticipantId
        newRepresentativeParticipantId: ParticipantId
        version: number
      }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return {
        teamId: input.teamId,
        previousRepresentativeParticipantId: prior.previousRepresentativeParticipantId,
        newRepresentativeParticipantId: prior.newRepresentativeParticipantId,
        version: prior.version,
        deduplicated: true,
      }
    }

    const teamPath = `lessonRuns/${input.lessonRunId}/teams/${input.teamId}`
    const teamSnap = await tx.get(teamPath)
    if (!teamSnap.exists) throw new Error('Team not found')
    const team = teamSnap.data() as unknown as LessonTeam
    if (!team.memberParticipantIds.includes(input.newRepresentativeParticipantId)) {
      throw new Error('New representative must be a member of the team')
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== team.version) {
      throw new Error('Team version mismatch')
    }

    // ---- WRITE PHASE ----
    const previousRepresentativeParticipantId = team.representativeParticipantId
    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId: team.orgId,
      type: 'TEAM_REPRESENTATIVE_CHANGED',
      actorType: deps.actorType ?? 'TEACHER',
      actorId: deps.actorId,
      payload: {
        teamId: input.teamId,
        previousRepresentativeParticipantId: previousRepresentativeParticipantId ?? null,
        newRepresentativeParticipantId: input.newRepresentativeParticipantId,
        reason: input.reason,
      },
      idempotencyKey: `${input.teamId}:${input.idempotencyKey}`,
    }, nowValue)

    const newVersion = team.version + 1
    tx.set(teamPath, { ...team, representativeParticipantId: input.newRepresentativeParticipantId, version: newVersion })
    tx.set(idempotencyPath, {
      requestDigest,
      previousRepresentativeParticipantId: previousRepresentativeParticipantId ?? null,
      newRepresentativeParticipantId: input.newRepresentativeParticipantId,
      version: newVersion,
    })

    return {
      teamId: input.teamId,
      previousRepresentativeParticipantId,
      newRepresentativeParticipantId: input.newRepresentativeParticipantId,
      version: newVersion,
      deduplicated: false,
    }
  })
}

/** Production wiring: Firestore Admin SDK transaction adapter, matching joinLessonRun.ts/checkpoint.ts. Callable authorization happens in participants/onCall.ts, not here. */
const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

export const assignParticipantToTeamWithAdminSdk = (
  input: AssignParticipantToTeamInput & { actorId: string },
): Promise<AssignParticipantToTeamResult> => {
  const { actorId, ...rest } = input
  return assignParticipantToTeam({ firestore: adminSdkFirestore(), actorId }, rest)
}

export const rotateRepresentativeWithAdminSdk = (
  input: RotateRepresentativeInput & { actorId: string; actorType?: 'TEACHER' | 'SYSTEM' },
): Promise<RotateRepresentativeResult> => {
  const { actorId, actorType, ...rest } = input
  return rotateRepresentative({ firestore: adminSdkFirestore(), actorId, actorType }, rest)
}
