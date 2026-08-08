export type NotificationSeverity = 'IMPORTANT' | 'NORMAL' | 'REFERENCE'

/**
 * Every event `type` string this codebase has actually passed to
 * `appendLessonEventInTransaction`/`appendLessonEventWithAdminSdk` as of
 * Task10 (grepped across functions/src, excluding test files):
 * checkpoint.ts, interventions.ts, joinLessonRun.ts, phases/
 * transitionPhase.ts, recovery.ts, recoveryLifecycle.ts, responses/
 * confirmResponse.ts, responses/saveResponse.ts (x2), teams/assignTeam.ts
 * (x2).
 *
 * Classification rationale:
 *  - IMPORTANT (sound on by default): anything that changes what a
 *    participant should be doing right now or signals an exceptional
 *    situation — lesson/phase transitions, teacher interventions/
 *    transfers, interruption/abort, and checkpoint restore (which can
 *    silently rewind a participant's own state, so it must not go unnoticed).
 *  - NORMAL (no sound, but surfaced): routine participant-facing progress —
 *    someone joining/recovering, a response getting confirmed, a proposal
 *    being submitted/decided, a team assignment/representative change.
 *  - REFERENCE: `RESPONSE_SAVED` is an autosave-draft event that can fire on
 *    nearly every keystroke/interval — explicitly named in the brief as a
 *    high-frequency event Phase C should be able to aggregate rather than
 *    surface as individual notifications.
 */
const SEVERITY_BY_EVENT_TYPE: Record<string, NotificationSeverity> = {
  LESSON_STATUS_CHANGED: 'IMPORTANT',
  PHASE_CHANGED: 'IMPORTANT',
  TEACHER_INTERVENTION_APPLIED: 'IMPORTANT',
  PRIMARY_TEACHER_TRANSFERRED: 'IMPORTANT',
  LESSON_INTERRUPTED: 'IMPORTANT',
  LESSON_ABORTED: 'IMPORTANT',
  CHECKPOINT_RESTORED: 'IMPORTANT',

  PARTICIPANT_JOINED: 'NORMAL',
  PARTICIPANT_RECOVERED: 'NORMAL',
  RESPONSE_CONFIRMED: 'NORMAL',
  PROPOSAL_SUBMITTED: 'NORMAL',
  PROPOSAL_DECIDED: 'NORMAL',
  TEAM_MEMBER_ASSIGNED: 'NORMAL',
  TEAM_REPRESENTATIVE_CHANGED: 'NORMAL',

  RESPONSE_SAVED: 'REFERENCE',
}

/**
 * Pure classifier from a lesson-event `type` string to a notification
 * severity. Defaults to `REFERENCE` for anything not explicitly listed
 * above — this is a deliberate extensibility choice (not a gap): Phase C
 * does not exist yet, and any event type it introduces (e.g. high-frequency
 * price-tick updates) should degrade safely to "aggregatable, no sound" by
 * default rather than this function needing to be updated in lockstep with
 * every future event type, or a new event type silently defaulting to
 * IMPORTANT/sound-on.
 */
export const classifyNotification = (eventType: string): NotificationSeverity =>
  SEVERITY_BY_EVENT_TYPE[eventType] ?? 'REFERENCE'

/** Sound is on by default only for IMPORTANT — matches the brief's "音はIMPORTANTのみ既定true". */
export const defaultSoundEnabled = (severity: NotificationSeverity): boolean => severity === 'IMPORTANT'

/** Minimal shape read from an already-appended lesson event (Firestore's `lessonRuns/{id}/events/{eventId}` doc — see appendLessonEvent.ts). */
export interface LessonEventForNotification {
  eventId: string
  type: string
  sequence: number
  serverOccurredAtMillis: number
  actorId?: string | null
  payload?: unknown
}

/**
 * A notification-history record derived from a lesson event. Per the
 * brief's "既存のイベントログ自体を通知履歴として扱う設計でも構いません",
 * this codebase does not introduce a second, separately-persisted
 * notification store — `lessonRuns/{lessonRunId}/events/{eventId}` (already
 * written by appendLessonEventInTransaction) IS the durable notification
 * history; this function is the read-side allow-list projection of one
 * event doc into the fields a notification UI/feed actually needs.
 *
 * Allow-list construction, same rationale as the public/display
 * projections (functions/src/lessonRuns/projections/): `actorId` and
 * `payload` are deliberately never copied through, even though the source
 * event doc carries them — a notification feed does not need to know who
 * acted or the raw payload contents (which can contain response bodies,
 * symbols, etc. not meant for a broadcast-style notification surface).
 */
export interface LessonNotificationRecord {
  eventId: string
  type: string
  sequence: number
  occurredAtMillis: number
  severity: NotificationSeverity
  soundEnabled: boolean
}

export const toNotificationRecord = (event: LessonEventForNotification): LessonNotificationRecord => {
  const severity = classifyNotification(event.type)
  return {
    eventId: event.eventId,
    type: event.type,
    sequence: event.sequence,
    occurredAtMillis: event.serverOccurredAtMillis,
    severity,
    soundEnabled: defaultSoundEnabled(severity),
  }
}
