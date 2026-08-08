/**
 * Mirrors Phase A's client-side `LessonRunStatus` (src/lib/lessonRuns/types.ts)
 * exactly. Functions and the client app do not share a types module for
 * `LessonRun` fields today — every existing functions/src file that touches
 * `LessonRun.status` (createLessonRun.ts, joinLessonRun.ts, checkpoint.ts)
 * treats it as a loose string rather than importing a shared type — so this
 * is a duplicated-by-necessity literal union, not a drift risk introduced by
 * this task. Keep it byte-for-byte identical to the client's definition if
 * either ever changes.
 */
export type LessonRunStatus =
  | 'DRAFT' | 'READY' | 'WAITING' | 'RUNNING' | 'PAUSED'
  | 'INTERRUPTED' | 'REFLECTION' | 'COMPLETED' | 'ABORTED' | 'ARCHIVED'

/**
 * Explicit transition table (§8.2 lifecycle + this task's brief), the same
 * "fully enumerated table, `canX` is a pure reference into it" shape as
 * `authorization.ts`'s `lessonControlPermissions` / `canControlLesson`.
 *
 * Design judgment calls, since §8.2 describes each status's meaning but not
 * a full transition table:
 *
 *  - "任意の実施中状態からABORTEDを許可" (brief) is read as: any status in
 *    which a lesson is actively being run *or* is paused/stalled mid-run —
 *    WAITING (students are already gathering for this specific run),
 *    RUNNING, PAUSED, INTERRUPTED. DRAFT/READY are excluded because nothing
 *    has started yet for anyone to abort (§8.2 step 1-2: teacher-only, no
 *    students admitted). REFLECTION is excluded: by the time REFLECTION is
 *    reached, market/decision-making has already stopped (§8.2 step 7) and
 *    results exist to review, so there is nothing left that "aborting"
 *    would meaningfully cut short — the closest equivalent action is simply
 *    letting REFLECTION run its course to COMPLETED. COMPLETED/ABORTED/
 *    ARCHIVED are excluded as already-terminal.
 *  - ARCHIVED has no defined inbound transition in this table. §8.2 step 10
 *    ("年度アーカイブ等") describes archival as an out-of-band operation
 *    (e.g. an end-of-year batch job), not something `transitionPhase`
 *    (this task's Callable) is asked to drive — a future archival task can
 *    extend this table deliberately rather than this task guessing at its
 *    semantics.
 *  - REFLECTION -> RUNNING and COMPLETED -> RUNNING are absent (never
 *    listed as reachable targets from those statuses), directly satisfying
 *    the brief's explicit rejection cases and the global constraint that
 *    REFLECTION is a one-way door.
 */
const TRANSITIONS: Record<LessonRunStatus, LessonRunStatus[]> = {
  DRAFT: ['READY'],
  READY: ['WAITING'],
  WAITING: ['RUNNING', 'ABORTED'],
  RUNNING: ['PAUSED', 'INTERRUPTED', 'REFLECTION', 'ABORTED'],
  PAUSED: ['RUNNING', 'INTERRUPTED', 'ABORTED'],
  INTERRUPTED: ['WAITING', 'ABORTED'],
  REFLECTION: ['COMPLETED'],
  COMPLETED: [],
  ABORTED: [],
  ARCHIVED: [],
}

export const canTransitionRun = (from: LessonRunStatus, to: LessonRunStatus): boolean =>
  TRANSITIONS[from].includes(to)
