import { collection, onSnapshot, type Firestore, type Unsubscribe as FirestoreUnsubscribe } from 'firebase/firestore'

/**
 * Client-side mirror of functions/src/lessonRuns/responses/repository.ts's
 * `LessonResponse` (Admin SDK-only fields dropped, same rationale as
 * participants.ts). Deliberately does NOT humanize/label participantId,
 * teamId, phaseId, or inputId — raw domain identity stays intact at this
 * layer; label formatting is the caller's job (see lessonLabels.ts).
 */
export type LessonResponseStatus = 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'CONFIRMED'

export interface LessonResponseView {
  id: string
  participantId?: string
  teamId?: string
  phaseId: string
  inputId: string
  status: LessonResponseStatus
}

/** Detaches the listener this subscribe call attached. */
export type Unsubscribe = () => void

/**
 * Teacher-facing response roster, read directly from Firestore via a single
 * collection-level subscription (no N+1 per-response reads) — mirrors the
 * pattern in participants.ts's `subscribeLessonParticipants`.
 */
export const subscribeLessonResponses = (
  firestore: Firestore,
  lessonRunId: string,
  onUpdate: (responses: LessonResponseView[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const responsesRef = collection(firestore, `lessonRuns/${lessonRunId}/responses`)
  const detach: FirestoreUnsubscribe = onSnapshot(
    responsesRef,
    (snapshot) => onUpdate(snapshot.docs.map((doc) => doc.data() as LessonResponseView)),
    (error) => onError?.(error),
  )
  return detach
}
