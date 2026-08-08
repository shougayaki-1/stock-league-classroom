import { collection, onSnapshot, type Firestore, type Unsubscribe as FirestoreUnsubscribe } from 'firebase/firestore'

/**
 * Client-side mirror of functions/src/lessonRuns/participants/repository.ts's
 * `LessonParticipant` (Admin SDK types like `FirestoreTimestampField` are
 * intentionally dropped — the client only ever reads this shape back, never
 * writes the timestamp sentinel form). Duplicated for the same reason every
 * other lessonRuns client module duplicates a server-side shape (see
 * transitionPhase.ts's `LessonRunStatus`, authorization.ts's comment here).
 *
 * `displayName` is the participant's real name (統合仕様書§23.6: 教師画面は
 * 本名を原則表示) — this module is teacher-only, so callers may render it
 * as-is. It must never be piped into a student- or classroom-display-facing
 * component; those consume the RTDB projections in liveRepository.ts
 * instead, which never carry this field.
 */
export interface LessonParticipantView {
  id: string
  lessonRunId: string
  orgId: string
  authUid: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  teamId?: string
  status: 'ACTIVE' | 'TEMPORARILY_DISCONNECTED' | 'ABSENT' | 'OBSERVER' | 'LATE_JOIN' | 'MIGRATING_DEVICE' | 'SUSPENDED'
  sessionVersion: number
}

/** Detaches the listener this subscribe call attached. */
export type Unsubscribe = () => void

/**
 * Teacher-facing participant roster, read directly from Firestore (the
 * system of record — see participants/repository.ts's JSDoc) rather than
 * from the RTDB `lessonRunPublic`/`lessonRunDisplay` projections in
 * liveRepository.ts. Those projections are deliberately stripped of
 * per-participant identity/status detail (broadcast-safe only); the teacher
 * monitor in `ParticipantMonitor` needs exactly the detail those projections
 * omit (real names, per-participant status, externalIdentifier for
 * duplicate detection), and Firestore Security Rules already grant teachers
 * (`activeMember` — see Task 2/3) read access to
 * `lessonRuns/{lessonRunId}/participants`, so this reads that collection
 * directly instead of inventing a new Callable.
 */
export const subscribeLessonParticipants = (
  firestore: Firestore,
  lessonRunId: string,
  onUpdate: (participants: LessonParticipantView[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const participantsRef = collection(firestore, `lessonRuns/${lessonRunId}/participants`)
  const detach: FirestoreUnsubscribe = onSnapshot(
    participantsRef,
    (snapshot) => onUpdate(snapshot.docs.map((doc) => doc.data() as LessonParticipantView)),
    (error) => onError?.(error),
  )
  return detach
}
