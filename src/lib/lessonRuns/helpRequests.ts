import { httpsCallable, type Functions } from 'firebase/functions'

export interface RequestLessonHelpInput {
  lessonRunId: string
  idempotencyKey: string
}

export interface RequestLessonHelpResult {
  deduplicated: boolean
}

/**
 * Client wrapper for the 困りごとボタン (Task 12 brief Step 4): appends a
 * `STUDENT_HELP_REQUESTED` lesson event (naming convention matches Phase A's
 * `PARTICIPANT_JOINED`/`RESPONSE_CONFIRMED` — see appendLessonEvent.ts).
 *
 * "匿名集計" (anonymous aggregation, brief Step 4 / integrated spec §23.4
 * "教師へ困りごとの集計") is interpreted here as: anonymous to OTHER
 * STUDENTS, not to the teacher. A teacher who wants to help a specific
 * struggling student needs to know who raised their hand — an aggregate
 * count alone is not actionable for that intervention. So this event is a
 * normal `actorType: 'STUDENT'`/`actorId: <participantId>` event exactly
 * like every other lesson event (appendLessonEventInTransaction always
 * records an actor); the anonymity guarantee is enforced at the PROJECTION
 * boundary instead — `LessonRunPublicState` (liveTypes.ts), the only
 * channel every student in the run reads, is a hand-built allow-list that
 * has no per-participant field at all, so a help-request event can never
 * surface a name/identifier to classmates no matter what the teacher's own
 * (Firestore-only, teacher-authorized) view shows. See task-12-report.md's
 * "困りごとボタンの匿名性の解釈" section for the full reasoning and the
 * (deliberately) open question this leaves for whoever builds the backend.
 *
 * NOTE: no `requestLessonHelpCallable` exists yet in functions/src — Task
 * 12's brief scopes only `src/components/student/*`, so implementing the
 * Cloud Function (append the event, and give the teacher's screen a summary
 * of it) is left for a follow-up backend task. Calling this today will
 * reject with a Functions `not-found` error; `LessonPlayPage` treats that
 * as a normal, recoverable failure (see its `handleRequestHelp`) rather
 * than crashing, so the student-facing UI is fully usable/testable now and
 * "just works" the moment that Callable is deployed.
 */
export const requestLessonHelp = async (functions: Functions, input: RequestLessonHelpInput): Promise<RequestLessonHelpResult> => {
  const callable = httpsCallable<RequestLessonHelpInput, RequestLessonHelpResult>(functions, 'requestLessonHelpCallable')
  const result = await callable(input)
  return result.data
}
