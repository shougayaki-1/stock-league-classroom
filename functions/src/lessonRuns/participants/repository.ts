import { getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId, ParticipantStatus, TeamId } from '@stock-league/lesson-runtime-types'

/**
 * Firestore system of record for lesson-run participants. `syncLessonRunMembership`
 * (membershipMirror.ts) reads this shape to derive the RTDB
 * `lessonRunMembership` mirror, but never writes it back — Firestore stays
 * the single source of truth.
 */
export interface LessonParticipant {
  id: ParticipantId
  lessonRunId: string
  orgId: string
  authUid: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  teamId?: TeamId
  status: ParticipantStatus
  sessionVersion: number
  joinedAt: unknown
  lastSeenAt: unknown
}

interface FirestoreDoc {
  set: (path: string, data: Record<string, unknown>) => Promise<void>
}
export interface UpsertParticipantDeps {
  firestore: FirestoreDoc
}

/**
 * Upsert, not append: writing the same `participant.id` twice replaces the
 * prior record in place at a deterministic path, matching how
 * `syncLessonRunMembership` treats the RTDB mirror (`set()`, full replace).
 * Callers (Task 3's join/leave/status-change Callables) are responsible for
 * idempotency and authorization — this is a plain persistence primitive.
 */
export const upsertParticipant = async (
  deps: UpsertParticipantDeps,
  participant: LessonParticipant,
): Promise<LessonParticipant> => {
  const path = `lessonRuns/${participant.lessonRunId}/participants/${participant.id}`
  await deps.firestore.set(path, { ...participant })
  return participant
}

/** Production wiring: Firestore Admin SDK. */
export const upsertParticipantWithAdminSdk = (participant: LessonParticipant): Promise<LessonParticipant> => {
  const db = getFirestore()
  return upsertParticipant({
    firestore: { set: async (path, data) => { await db.doc(path).set(data) } },
  }, participant)
}
