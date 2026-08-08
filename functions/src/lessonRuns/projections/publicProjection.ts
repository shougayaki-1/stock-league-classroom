import { getDatabase } from 'firebase-admin/database'
import { classifyNotification } from '../notifications'
import { toLessonRunDisplayState, type LessonRunDisplayState } from './displayProjection'
import type { LessonRunProjectionSource } from './source'

/**
 * A single broadcast-safe notification on the shared `lessonRunPublic/
 * {lessonRunId}` node. Server-side counterpart of src/lib/lessonRuns/
 * liveTypes.ts's `LessonRunPublicNotification` — see that file's JSDoc for
 * why this carries no actor identity or event payload.
 */
export interface LessonRunPublicNotification {
  id: string
  type: string
  severity: 'IMPORTANT' | 'NORMAL' | 'REFERENCE'
  occurredAtMillis: number
}

/**
 * Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's
 * `LessonRunPublicState` (see source.ts's JSDoc for why this codebase
 * duplicates the shape instead of importing across the functions/src
 * rootDir boundary). Keep both in sync by hand.
 */
export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
  orgId: string
  remainingPhaseSeconds: number | null
  publicTask: string | null
  notifications: LessonRunPublicNotification[]
}

/**
 * Projects the full server-side `LessonRunProjectionSource` down to the
 * whole-class-broadcast-safe `LessonRunPublicState`.
 *
 * SECURITY-CRITICAL (spec §26-1 / this task's brief Step 1): built by
 * ALLOW-LIST, same discipline as `toLessonRunDisplayState`
 * (displayProjection.ts) — every output field is listed explicitly, `source`
 * is never spread, and `source.teams[]`/`source.recentNotifications[]` are
 * mapped through their own allow-listed field lists (never
 * `individualResponses`, `unsubmittedParticipantIds`, event `actorId`, or
 * event `payload`).
 */
export const toLessonRunPublicState = (source: LessonRunProjectionSource, nowMillis: number): LessonRunPublicState => ({
  status: source.status,
  currentPhaseId: source.currentPhaseId,
  updatedAtMillis: source.updatedAtMillis,
  orgId: source.orgId,
  remainingPhaseSeconds: remainingSeconds(source.currentPhaseEndsAtMillis, nowMillis),
  publicTask: source.currentPhasePublicTask,
  notifications: source.recentNotifications.map((event) => ({
    id: event.id,
    type: event.type,
    severity: classifyNotification(event.type),
    occurredAtMillis: event.occurredAtMillis,
  })),
})

/** Plain countdown, clamped so a phase whose end has already passed reports 0 rather than a negative number. */
const remainingSeconds = (endsAtMillis: number | null, nowMillis: number): number | null => {
  if (endsAtMillis === null) return null
  return Math.max(0, Math.round((endsAtMillis - nowMillis) / 1000))
}

export interface PublishLessonProjectionDeps {
  setPublicState: (lessonRunId: string, state: LessonRunPublicState) => Promise<void>
  setDisplayState: (lessonRunId: string, state: LessonRunDisplayState) => Promise<void>
  now?: () => number
}
export interface PublishLessonProjectionInput {
  lessonRunId: string
  source: LessonRunProjectionSource
}

/**
 * Composes both projections and publishes them to their independent
 * top-level RTDB nodes (`lessonRunPublic/{lessonRunId}`,
 * `lessonRunDisplay/{lessonRunId}` — see database.rules.json; never nested
 * under a shared ancestor, matching lessonRunPublic/lessonRunPrivate's
 * existing split). Both projections are computed from the SAME `nowMillis`
 * read, so `remainingPhaseSeconds` and anything display-side that later
 * needs a clock stay consistent with each other for a single publish call.
 *
 * Callers (a future phase-transition/tick Callable — not built by this
 * task) are responsible for assembling `LessonRunProjectionSource` from
 * Firestore; this function only ever touches the already-safe projected
 * output, never the source's forbidden fields directly.
 */
export const publishLessonProjection = async (
  deps: PublishLessonProjectionDeps,
  input: PublishLessonProjectionInput,
): Promise<{ publicState: LessonRunPublicState; displayState: LessonRunDisplayState }> => {
  const nowMillis = deps.now ? deps.now() : Date.now()
  const publicState = toLessonRunPublicState(input.source, nowMillis)
  const displayState = toLessonRunDisplayState(input.source, nowMillis)
  await deps.setPublicState(input.lessonRunId, publicState)
  await deps.setDisplayState(input.lessonRunId, displayState)
  return { publicState, displayState }
}

/** Production wiring: RTDB Admin SDK, matching membershipMirror.ts's `syncLessonRunMembershipWithAdminSdk`. */
export const publishLessonProjectionWithAdminSdk = (
  input: PublishLessonProjectionInput,
): Promise<{ publicState: LessonRunPublicState; displayState: LessonRunDisplayState }> =>
  publishLessonProjection({
    setPublicState: async (lessonRunId, state) => { await getDatabase().ref(`lessonRunPublic/${lessonRunId}`).set(state) },
    setDisplayState: async (lessonRunId, state) => { await getDatabase().ref(`lessonRunDisplay/${lessonRunId}`).set(state) },
  }, input)
