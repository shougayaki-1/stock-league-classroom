import type { LessonRunProjectionSource } from './source'

export type LessonRunDisplayMode = 'START' | 'LIVE' | 'END' | 'EXPLANATION'

/**
 * Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's
 * `LessonRunDisplayState` (see source.ts's JSDoc for why this codebase
 * duplicates the shape instead of importing across the functions/src
 * rootDir boundary). Keep both in sync by hand.
 */
export interface LessonRunDisplayState {
  orgId: string
  mode: LessonRunDisplayMode
  title: string
  goal: string | null
  teams: LessonRunDisplayTeamSummary[]
  teacherGuidance: string | null
  updatedAtMillis: number
}

export interface LessonRunDisplayTeamSummary {
  teamId: string
  displayName: string
  publicAggregateLabel: string | null
}

/**
 * Pure status -> classroom-screen-mode mapping. DRAFT/READY/WAITING (no
 * market activity has started yet, students may still be joining) show the
 * START screen; RUNNING/PAUSED/INTERRUPTED (the lesson is actively
 * mid-flight, even if momentarily paused/stalled) show LIVE; REFLECTION
 * (market activity has stopped, results are being discussed — see
 * phases/stateMachine.ts's TRANSITIONS table JSDoc) shows EXPLANATION;
 * COMPLETED/ABORTED/ARCHIVED show END. An unrecognized status defaults to
 * START — the least-informative screen — rather than guessing LIVE and
 * risking the projector showing in-progress-looking content for a run that
 * never actually started.
 */
export const deriveDisplayMode = (status: string): LessonRunDisplayMode => {
  switch (status) {
    case 'RUNNING':
    case 'PAUSED':
    case 'INTERRUPTED':
      return 'LIVE'
    case 'REFLECTION':
      return 'EXPLANATION'
    case 'COMPLETED':
    case 'ABORTED':
    case 'ARCHIVED':
      return 'END'
    default:
      return 'START'
  }
}

/**
 * Projects the full server-side `LessonRunProjectionSource` down to the
 * classroom-projector-safe `LessonRunDisplayState`.
 *
 * SECURITY-CRITICAL (spec §26-1 / this task's brief Step 1): built by
 * ALLOW-LIST — every field of the returned object is listed explicitly
 * below. This function deliberately does NOT spread `source` (`{...source}`)
 * anywhere, so a future field added to `LessonRunProjectionSource` (e.g. a
 * new private coefficient) is excluded by default and requires someone to
 * deliberately edit this function to ever reach the classroom screen —
 * the opposite of a deny-list (`delete result.randomSeed`), which would
 * silently leak any newly-added secret field nobody remembered to strip.
 */
// The second parameter (`nowMillis`) is accepted but currently unused by the
// display projection itself (no countdown is shown on the projector screen
// today, unlike LessonRunPublicState.remainingPhaseSeconds). It is kept in
// the signature so `publishLessonProjection` (publicProjection.ts) can call
// both projection functions with one shared clock read, and so a future
// projector-side countdown can be added here without changing call sites.
export const toLessonRunDisplayState = (source: LessonRunProjectionSource, _nowMillis: number): LessonRunDisplayState => ({
  orgId: source.orgId,
  mode: deriveDisplayMode(source.status),
  title: source.title,
  goal: source.goal,
  teams: source.teams.map((team) => ({
    teamId: team.id,
    displayName: team.displayName,
    publicAggregateLabel: team.publicAggregateLabel,
  })),
  teacherGuidance: source.teacherGuidance,
  updatedAtMillis: source.updatedAtMillis,
})
