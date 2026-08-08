import { httpsCallable, type Functions } from 'firebase/functions'
import type { LessonRunStatus } from './types'

export interface TransitionPhaseInput {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  targetPhaseId?: string
  reason: string
  idempotencyKey: string
}

export interface TransitionPhaseResult {
  status: LessonRunStatus
  currentPhaseId: string | null
  deduplicated: boolean
}

/**
 * Client wrapper for the transitionPhaseCallable Callable. `actorId` and
 * `orgId` are resolved server-side (verified auth token / the run's own
 * stored orgId respectively) — the client never supplies or receives them,
 * matching checkpoint.ts's restoreCheckpoint wrapper.
 */
export const transitionPhase = async (functions: Functions, input: TransitionPhaseInput): Promise<TransitionPhaseResult> => {
  const callable = httpsCallable<TransitionPhaseInput, TransitionPhaseResult>(functions, 'transitionPhaseCallable')
  const result = await callable(input)
  return result.data
}
