/**
 * The full/internal shape of a lessonRun's live state as it exists
 * server-side (a composite of the `lessonRuns/{lessonRunId}` Firestore doc,
 * its current phase, its teams, and its recent event log) — i.e. everything
 * `toLessonRunPublicState`/`toLessonRunDisplayState` are handed as input and
 * must project down from, never pass through unfiltered.
 *
 * `functions` and the client app (`src/lib`) do not share a types module
 * (see functions/src/lessonRuns/phases/stateMachine.ts's `LessonRunStatus`
 * JSDoc for the established precedent) — `rootDir: "src"` in
 * functions/tsconfig.json makes importing anything under the repo's
 * top-level `src/` a compile error. This type is therefore a
 * duplicated-by-necessity server-side counterpart to the client's
 * `LessonRunPublicState`/`LessonRunDisplayState` (src/lib/lessonRuns/
 * liveTypes.ts) — the two are kept in sync by convention/review, not by the
 * type system, exactly like `LessonRunStatus` already is.
 *
 * FORBIDDEN FIELDS — the entire reason this type is split from the public/
 * display projections: `randomSeed`, `restoreGeneration`, and `future` must
 * never appear in any value returned by `toLessonRunPublicState` or
 * `toLessonRunDisplayState` (spec §26-1; see liveTypes.ts's
 * LessonRunPrivateState). `teams[].individualResponses` and
 * `teams[].unsubmittedParticipantIds` must never appear either — the first
 * is each member's raw response body (Firestore system of record only), the
 * second would let the classroom-wide public/display feed be used to single
 * out which specific students haven't answered yet, which is exactly the
 * kind of participant-identifying signal §26-1's public/private split
 * exists to keep off any broadly-readable node.
 */
export interface LessonRunProjectionSource {
  orgId: string
  status: string
  title: string
  goal: string | null
  currentPhaseId: string | null
  /** The current phase's teacher-authored, already-public prompt/task text (safe for LessonRunPublicState.publicTask). */
  currentPhasePublicTask: string | null
  /** Epoch millis the current phase's timer ends, or null when no timer is running. Used only to derive a countdown (`remainingPhaseSeconds`) — never exposed itself. */
  currentPhaseEndsAtMillis: number | null
  updatedAtMillis: number
  /** Teacher-authored guidance meant for the whole class (projector display). */
  teacherGuidance: string | null
  teams: LessonRunProjectionTeamSource[]
  /** Recent lesson-event-log entries eligible for broadcast — see notifications.ts's `classifyNotification`. */
  recentNotifications: LessonRunProjectionNotificationSource[]

  /** FORBIDDEN — see this interface's JSDoc. Never read by any projection function. */
  randomSeed: string
  /** FORBIDDEN — see this interface's JSDoc. Never read by any projection function. */
  restoreGeneration: number
  /** FORBIDDEN — the private future-price/coefficient plan itself (spec §26-1). Never read by any projection function. */
  future?: unknown
}

export interface LessonRunProjectionTeamSource {
  id: string
  displayName: string
  /** Already-public aggregate figure/label (e.g. rank), safe for LessonRunDisplayState. Null when nothing is publishable yet. */
  publicAggregateLabel: string | null
  /** FORBIDDEN — raw per-member response bodies. Never read by any projection function. */
  individualResponses?: Record<string, unknown>
  /** FORBIDDEN — reveals which specific participants have not yet submitted. Never read by any projection function. */
  unsubmittedParticipantIds?: string[]
}

export interface LessonRunProjectionNotificationSource {
  id: string
  /** The underlying lesson-event `type` string (appendLessonEventInTransaction's `input.type`) — fed to `classifyNotification`. */
  type: string
  occurredAtMillis: number
  /** FORBIDDEN — internal-only actor identity. Never read by any projection function. */
  actorId?: string | null
  /** FORBIDDEN — the raw event payload. Never read by any projection function. */
  payload?: unknown
}
