import { getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId, TeamId } from '@stock-league/lesson-runtime-types'

/**
 * Firestore system of record for a lesson-run team, stored at
 * `lessonRuns/{lessonRunId}/teams/{id}`. `version` is a monotonically
 * incrementing counter bumped on every mutating write (member assignment,
 * representative rotation) — see assignTeam.ts for how it doubles as an
 * optimistic-concurrency guard for representative rotation.
 */
export interface LessonTeam {
  id: TeamId
  lessonRunId: string
  orgId: string
  displayName: string
  memberParticipantIds: ParticipantId[]
  representativeParticipantId?: ParticipantId
  confirmationMode: 'REPRESENTATIVE' | 'ALL' | 'QUORUM'
  /** Only meaningful when confirmationMode === 'QUORUM': how many individual member confirmations count as team consensus. Aggregation logic (not this file's concern) reads it. */
  requiredApprovalCount?: number
  version: number
}

/**
 * Pure load-balancing rule for `assignParticipantToTeam`: picks the team
 * with the fewest current members so team sizes stay as even as possible
 * over a sequence of assignments. Ties resolve to the first (lowest-index)
 * team in the input array — deterministic, not random, so the same input
 * always produces the same output (important for idempotency-key replay
 * safety upstream in assignTeam.ts, and for testability).
 */
export const assignBalancedTeam = (teams: { id: TeamId; size: number }[]): TeamId => {
  if (teams.length === 0) throw new Error('At least one team is required')
  let best = teams[0]
  for (let index = 1; index < teams.length; index += 1) {
    if (teams[index].size < best.size) best = teams[index]
  }
  return best.id
}

/**
 * Pure per-participant permission check for "can this participant execute
 * a team confirmation action right now" — a different question from "how
 * many confirmations does the team need" (that is `requiredApprovalCount`,
 * an aggregation concern owned by whatever collects individual
 * confirmations, not this predicate).
 *
 *  - REPRESENTATIVE: only the team's designated representative may act.
 *  - ALL: every team member may act individually.
 *  - QUORUM: also every team member may act individually — QUORUM differs
 *    from ALL only in how many of those individual actions are required
 *    before the team's response counts as final, which is exactly
 *    `requiredApprovalCount`'s job, not this function's.
 */
export const canConfirmTeamResponse = (team: LessonTeam, participantId: ParticipantId): boolean => {
  if (team.confirmationMode === 'REPRESENTATIVE') {
    return team.representativeParticipantId === participantId
  }
  return team.memberParticipantIds.includes(participantId)
}

interface FirestoreDoc {
  set: (path: string, data: Record<string, unknown>) => Promise<void>
}
export interface UpsertTeamDeps {
  firestore: FirestoreDoc
}

/**
 * Upsert primitive, matching participants/repository.ts's upsertParticipant
 * shape. Not used inside Firestore transactions (assignTeam.ts writes team
 * docs directly via its own `tx.set`) — this is for team-creation flows
 * outside a transaction.
 *
 * IMPORTANT: this function does NOT update
 * `lessonRuns/{lessonRunId}/meta/teamsIndex` (the `{ teamIds: TeamId[] }`
 * doc `assignParticipantToTeam`, assignTeam.ts, reads to know which teams
 * exist). It only writes `lessonRuns/{lessonRunId}/teams/{team.id}`. A
 * caller that creates a new team here and wants it eligible for
 * `assignParticipantToTeam`'s load-balancing is responsible for also
 * appending the new team's id to `teamsIndex.teamIds` itself — this
 * function will not do it for them. As of this writing `upsertTeam` has no
 * production caller, so this has not yet caused an incident, but a future
 * team-creation Callable that overlooks this will silently produce teams
 * that never receive members.
 */
export const upsertTeam = async (deps: UpsertTeamDeps, team: LessonTeam): Promise<LessonTeam> => {
  const path = `lessonRuns/${team.lessonRunId}/teams/${team.id}`
  await deps.firestore.set(path, { ...team })
  return team
}

/** Production wiring: Firestore Admin SDK. */
export const upsertTeamWithAdminSdk = (team: LessonTeam): Promise<LessonTeam> => {
  const db = getFirestore()
  return upsertTeam({
    firestore: { set: async (path, data) => { await db.doc(path).set(data) } },
  }, team)
}
