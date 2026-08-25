import { collection, onSnapshot, type Firestore, type Unsubscribe as FirestoreUnsubscribe } from 'firebase/firestore'

/**
 * Client-side mirror of functions/src/lessonRuns/teams/repository.ts's
 * `LessonTeam` (Admin SDK-only fields intentionally dropped — same rationale
 * as participants.ts's `LessonParticipantView`).
 */
export interface LessonTeamView {
  id: string
  displayName: string
  memberParticipantIds: string[]
  representativeParticipantId?: string
  confirmationMode: 'REPRESENTATIVE' | 'ALL' | 'QUORUM'
}

/** Detaches the listener this subscribe call attached. */
export type Unsubscribe = () => void

/**
 * Teacher-facing team roster, read directly from Firestore via a single
 * collection-level subscription (no N+1 per-team reads) — mirrors the
 * pattern in participants.ts's `subscribeLessonParticipants`.
 */
export const subscribeLessonTeams = (
  firestore: Firestore,
  lessonRunId: string,
  onUpdate: (teams: LessonTeamView[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const teamsRef = collection(firestore, `lessonRuns/${lessonRunId}/teams`)
  const detach: FirestoreUnsubscribe = onSnapshot(
    teamsRef,
    (snapshot) => onUpdate(snapshot.docs.map((doc) => doc.data() as LessonTeamView)),
    (error) => onError?.(error),
  )
  return detach
}
