/**
 * A single broadcast-safe notification surfaced on the shared
 * `lessonRunPublic/{lessonRunId}` node (Phase B/Task10). Deliberately
 * carries no actor identity and no event payload — `lessonRunPublic` is one
 * node shared by every participant in the run (see database.rules.json),
 * so anything placed here is visible to the entire class at once. Only
 * `severity`/`type`/`occurredAtMillis` are safe at that broadcast
 * granularity; per-participant-addressed content has no home on this node
 * (see functions/src/lessonRuns/notifications.ts's `classifyNotification`
 * for how `severity` is derived from the underlying lesson-event type).
 */
export interface LessonRunPublicNotification {
  id: string
  type: string
  severity: 'IMPORTANT' | 'NORMAL' | 'REFERENCE'
  occurredAtMillis: number
}

/**
 * Fields safe to send to every participant in a lessonRun. Phase A defines
 * only the envelope; Phase B (Task10) adds the phase-timer/public-task/
 * notification fields below.
 *
 * INVARIANT (spec §26-1): this type must never gain a field that reveals
 * future prices, non-public coefficients, or a random seed. If a field here
 * would let a participant compute or look up such a value, it belongs in
 * LessonRunPrivateState instead — never as an optional/hidden field on this
 * type, because RTDB has no field-level rules: the whole node's `.read`
 * grant applies to everything under it.
 *
 * Every producer of this shape (functions/src/lessonRuns/projections/
 * publicProjection.ts's `toLessonRunPublicState`) MUST build the output
 * object by listing each field explicitly (an allow-list) rather than
 * spreading an internal/private source object — see that file's JSDoc for
 * why deny-list stripping is rejected as a design here.
 */
export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
  /** Required by database.rules.json's teacher-read branch (`data.child('orgId')`); not sensitive on its own — every lessonRunPublic/lessonRunPrivate/lessonRunTeamState node already carries it. */
  orgId: string
  /** Seconds remaining in the current phase, or null when no phase/timer is active. Never derived from a value that would let a participant back-compute a future price schedule — only a plain countdown. */
  remainingPhaseSeconds: number | null
  /** The current phase's teacher-authored, already-public prompt/task text. Never the private phase-transition/pricing plan. */
  publicTask: string | null
  /** Broadcast-safe notifications only — see LessonRunPublicNotification's JSDoc. */
  notifications: LessonRunPublicNotification[]
}

/** `lessonRunDisplay/{lessonRunId}`'s mode: which screen the classroom projector should render. */
export type LessonRunDisplayMode = 'START' | 'LIVE' | 'END' | 'EXPLANATION'

/**
 * A single team's projector-safe summary. Never member identities, never
 * individual responses, never who has/hasn't submitted yet — those live only
 * in Firestore (system of record) and in the per-team
 * `lessonRunTeamState/{lessonRunId}/{teamId}` RTDB node, which is scoped to
 * that team's own members plus teachers, not the whole-class display.
 */
export interface LessonRunDisplayTeamSummary {
  teamId: string
  displayName: string
  /** A single already-public aggregate figure/label (e.g. a rank or score), or null when nothing is publishable yet. Never raw per-member data. */
  publicAggregateLabel: string | null
}

/**
 * Fields safe to project onto an unauthenticated classroom screen
 * (Phase B/Task10). Reached only via `lessonRunDisplay/{lessonRunId}`
 * (database.rules.json) after a one-time session-token exchange for a
 * Firebase custom token scoped to this run via the `displayRunId` claim —
 * see functions/src/lessonRuns/projections/displaySession.ts. `orgId` is
 * the only authorization-adjacent field carried here (required by the
 * teacher-read branch of the RTDB rule, same as LessonRunPublicState); no
 * other membership/role/session information belongs on this type.
 *
 * Same allow-list-construction requirement as LessonRunPublicState — see
 * functions/src/lessonRuns/projections/displayProjection.ts's
 * `toLessonRunDisplayState`.
 */
export interface LessonRunDisplayState {
  orgId: string
  mode: LessonRunDisplayMode
  title: string
  goal: string | null
  teams: LessonRunDisplayTeamSummary[]
  /** Teacher-authored guidance text meant for the whole class to see on the projector (e.g. "スマホを置いて前を見てください"). Never internal teacher-only notes. */
  teacherGuidance: string | null
  updatedAtMillis: number
}

/**
 * Fields that must never reach a participant: future price plans, seeds,
 * non-public coefficients (spec §26-1). This type's data must live at a
 * SEPARATE top-level RTDB path from LessonRunPublicState — see
 * database.rules.json's `lessonRunPrivate` node. Do not nest this under
 * `lessonRunPublic/{lessonRunId}`; RTDB's read cascade means a broad grant
 * on an ancestor cannot be revoked by a `.read: false` on a descendant, so
 * nesting private data under a publicly-readable node reintroduces exactly
 * the vulnerability this split exists to close (see the "旧実装の廃止範囲"
 * section of this plan and Phase 0's findings on `prices/{id}/runtime` and
 * `companies/{id}/phases`).
 */
export interface LessonRunPrivateState {
  randomSeed: string
  restoreGeneration: number
  updatedAtMillis: number
}
