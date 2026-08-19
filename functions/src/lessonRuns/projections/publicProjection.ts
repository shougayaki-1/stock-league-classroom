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
/** Allow-listed per-team summary safe for the whole-class-broadcast node — teamId/displayName only, never publicAggregateLabel/individualResponses/unsubmittedParticipantIds (those stay on LessonRunDisplayState, the projector-only node). */
export interface LessonRunPublicTeamSummary {
  teamId: string
  displayName: string
}

export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
  orgId: string
  remainingPhaseSeconds: number | null
  publicTask: string | null
  notifications: LessonRunPublicNotification[]
  title: string
  teams: LessonRunPublicTeamSummary[]
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
  title: source.title,
  teams: source.teams.map((team) => ({ teamId: team.id, displayName: team.displayName })),
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
    // Task 9: `lessonRunPublic/{lessonRunId}` is a SHARED node — besides
    // this generic, subject-agnostic publisher, `homeEconomics/
    // processRound.ts`'s `publishRealtimeStateWithAdminSdk` also writes
    // `economicFactors` onto the very same node (via `.update()`, never
    // `.set()`), and Task 12 will add a `householdClassComparison` field
    // the same way. Neither of those fields is part of
    // `LessonRunPublicState`'s allow-list, so if this function ever ran
    // with `.set()` AFTER either of those writes, it would silently wipe
    // them out. `.update()` here is a partial multi-field merge — it
    // preserves any sibling key already on the node (economicFactors,
    // the future comparison field) while still fully replacing every field
    // `LessonRunPublicState` itself owns. Verified safe for every current
    // caller: this function has no production caller wired up yet (see
    // this file's own JSDoc — "a future phase-transition/tick Callable,
    // not built by this task"), and its own test suite constructs
    // `LessonRunPublicState` fresh each call, so there is no existing code
    // path relying on `.set()`'s "wipe everything not in this write"
    // semantics for this node.
    setPublicState: async (lessonRunId, state) => { await getDatabase().ref(`lessonRunPublic/${lessonRunId}`).update(state as unknown as Record<string, unknown>) },
    // `lessonRunDisplay/{lessonRunId}` is written by this function and by
    // `setTeacherGuidance.ts`'s `setTeacherGuidanceWithAdminSdk`, both of
    // which always publish the FULL `LessonRunDisplayState` object via
    // `.set()`'s whole-node-replace semantics (never leave a stale field
    // from a previous publish behind). Task 13 added a THIRD writer,
    // `showHouseholdComparisonOnDisplayCallable`
    // (functions/src/homeEconomics/onCall.ts), which instead uses
    // `.update()` to switch just the `mode`/`householdClassComparison`
    // fields without disturbing the rest of the node — so this node DOES
    // now have the same kind of cross-write shape as `lessonRunPublic`
    // above, with one difference: that Callable's own JSDoc documents why
    // the resulting race (a subsequent whole-node `.set()` here reverting
    // the projector back to the status-derived mode) is accepted rather
    // than guarded against. See that JSDoc for the full explanation before
    // changing either writer.
    setDisplayState: async (lessonRunId, state) => { await getDatabase().ref(`lessonRunDisplay/${lessonRunId}`).set(state) },
  }, input)

/**
 * lessonRunId だけを受け取って教室表示と公開状態を発行し直す本番用の入口。
 *
 * `publishLessonProjectionWithAdminSdk` は source を呼び出し側が用意する
 * 前提だったため誰も呼べていなかった。この関数が `buildProjectionSource` と
 * 繋いで「授業の状態が変わったらこれを呼ぶ」だけで済むようにする。
 * lessonRun が存在しない場合は何もしない（削除済み run に対する遅延呼び出しを
 * エラーにしない）。
 */
export const publishLessonProjectionForRunWithAdminSdk = async (lessonRunId: string): Promise<void> => {
  const { buildProjectionSourceWithAdminSdk } = await import('./buildProjectionSource')
  const source = await buildProjectionSourceWithAdminSdk(lessonRunId)
  if (!source) return
  await publishLessonProjectionWithAdminSdk({ lessonRunId, source })
}
