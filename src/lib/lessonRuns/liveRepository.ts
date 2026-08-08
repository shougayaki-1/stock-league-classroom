import { off, onValue, ref, type Database } from 'firebase/database'
import type { LessonRunDisplayState, LessonRunPublicState } from './liveTypes'

/** Detaches the listener this subscribe call attached. Always call this before creating a replacement subscription for the same logical target. */
export type Unsubscribe = () => void

/** Wraps a teardown function so it only ever runs once — a caller that (harmlessly) calls the returned Unsubscribe more than once (e.g. once from a React effect cleanup and once from an explicit resubscribe guard) must not detach a second, unrelated listener that may have since been attached on the same path. */
const once = (fn: () => void): Unsubscribe => {
  let called = false
  return () => {
    if (called) return
    called = true
    fn()
  }
}

/**
 * Every `subscribeX` function below follows the same contract, on purpose:
 * it attaches exactly one `onValue` listener and returns a fresh
 * `Unsubscribe` closure that detaches exactly that listener (`off(ref,
 * 'value', thatSpecificCallback)`, never a bare `off(ref)` that would tear
 * down every listener on the path). None of these functions cache or dedupe
 * subscriptions by key internally — the caller fully owns the subscription's
 * lifecycle.
 *
 * This is what lets a caller satisfy the brief's "auth/membership変更時に
 * 古いlistenerを確実に解除する" requirement correctly: on re-login, an org
 * change, or a team/participant change, the caller calls the PREVIOUS
 * `Unsubscribe` before calling `subscribeX` again with the new
 * lessonRunId/teamId — e.g.
 *
 *   let unsubscribe: Unsubscribe | undefined
 *   const resubscribe = (lessonRunId: string) => {
 *     unsubscribe?.()
 *     unsubscribe = subscribePublicRun(database, lessonRunId, onUpdate)
 *   }
 *
 * A hook/component wiring this into React's effect-cleanup lifecycle is
 * explicitly out of this task's scope (see task-10-brief.md) — these
 * functions only need to make that wiring possible, not provide it.
 */
export const subscribePublicRun = (
  database: Database,
  lessonRunId: string,
  onUpdate: (state: LessonRunPublicState | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const nodeRef = ref(database, `lessonRunPublic/${lessonRunId}`)
  const listener = (snapshot: { val: () => unknown }) => onUpdate((snapshot.val() as LessonRunPublicState | null) ?? null)
  onValue(nodeRef, listener, (error: Error) => onError?.(error))
  return once(() => off(nodeRef, 'value', listener))
}

/**
 * Subscribes to the caller's OWN team's aggregate state
 * (`lessonRunTeamState/{lessonRunId}/{teamId}` — RTDB Rules restrict this
 * node to that team's own active members plus teachers; see
 * database.rules.json). `TeamState` is left generic because no
 * production writer of this node exists yet (tracked separately from this
 * task — see database.rules.test.ts's mirror-consistency table, which only
 * exercises the Rules themselves against a hand-seeded fixture); callers
 * type their own expected shape once a writer lands.
 */
export const subscribeOwnTeamState = <TeamState = Record<string, unknown>>(
  database: Database,
  lessonRunId: string,
  teamId: string,
  onUpdate: (state: TeamState | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const nodeRef = ref(database, `lessonRunTeamState/${lessonRunId}/${teamId}`)
  const listener = (snapshot: { val: () => unknown }) => onUpdate((snapshot.val() as TeamState | null) ?? null)
  onValue(nodeRef, listener, (error: Error) => onError?.(error))
  return once(() => off(nodeRef, 'value', listener))
}

/**
 * Subscribes to the classroom-projector state
 * (`lessonRunDisplay/{lessonRunId}` — reachable only after the caller has
 * already signed in with the Firebase custom token minted by
 * `exchangeDisplaySessionTokenCallable`, whose `displayRunId` claim RTDB
 * Rules check against this exact `lessonRunId`; see database.rules.json and
 * functions/src/lessonRuns/projections/displaySession.ts). This function
 * itself performs no auth — a caller that has not completed that exchange
 * will simply see `onError` fire with a permission-denied error.
 */
export const subscribeDisplayRun = (
  database: Database,
  lessonRunId: string,
  onUpdate: (state: LessonRunDisplayState | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const nodeRef = ref(database, `lessonRunDisplay/${lessonRunId}`)
  const listener = (snapshot: { val: () => unknown }) => onUpdate((snapshot.val() as LessonRunDisplayState | null) ?? null)
  onValue(nodeRef, listener, (error: Error) => onError?.(error))
  return once(() => off(nodeRef, 'value', listener))
}
