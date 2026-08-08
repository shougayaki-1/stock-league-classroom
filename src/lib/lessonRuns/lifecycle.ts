import { httpsCallable, type Functions } from 'firebase/functions'
import type { LessonRunStatus } from './types'

interface TransitionResult {
  status: LessonRunStatus
  currentPhaseId: string | null
  deduplicated: boolean
}

export interface InterruptLessonInput {
  lessonRunId: string
  reason: string
  interimResults?: Record<string, unknown>
  resumePhaseId?: string | null
  resumeCheckpointId?: string | null
  idempotencyKey: string
}

export interface InterruptLessonResult {
  transition: TransitionResult
  eventId: string
}

/** Client wrapper for interruptLessonCallable. actorId/orgId are resolved server-side, same pattern as checkpoint.ts / transitionPhase.ts. */
export const interruptLesson = async (functions: Functions, input: InterruptLessonInput): Promise<InterruptLessonResult> => {
  const callable = httpsCallable<InterruptLessonInput, InterruptLessonResult>(functions, 'interruptLessonCallable')
  const result = await callable(input)
  return result.data
}

export interface ResumeLessonInput {
  lessonRunId: string
  reason: string
  idempotencyKey: string
}

/**
 * Client wrapper for resumeLessonCallable. This only performs the
 * INTERRUPTED → WAITING half of resuming a lesson — once the teacher has
 * re-verified connections/teams, progressing WAITING → RUNNING reuses the
 * existing `transitionPhase` client wrapper (transitionPhase.ts) with
 * `targetStatus: 'RUNNING'`, not a separate function here.
 */
export const resumeLesson = async (functions: Functions, input: ResumeLessonInput): Promise<TransitionResult> => {
  const callable = httpsCallable<ResumeLessonInput, TransitionResult>(functions, 'resumeLessonCallable')
  const result = await callable(input)
  return result.data
}

export interface CompleteLessonInput {
  lessonRunId: string
  reason: string
  idempotencyKey: string
}

export interface CompleteLessonResult {
  finalResults: Record<string, unknown>
  checkpointId: string
  transition: TransitionResult
}

/** Client wrapper for completeLessonCallable. */
export const completeLesson = async (functions: Functions, input: CompleteLessonInput): Promise<CompleteLessonResult> => {
  const callable = httpsCallable<CompleteLessonInput, CompleteLessonResult>(functions, 'completeLessonCallable')
  const result = await callable(input)
  return result.data
}

export interface AbortLessonInput {
  lessonRunId: string
  reason: string
  completedPhaseIds?: string[]
  idempotencyKey: string
}

export interface AbortLessonResult {
  transition: TransitionResult
  eventId: string
}

/** Client wrapper for abortLessonCallable. */
export const abortLesson = async (functions: Functions, input: AbortLessonInput): Promise<AbortLessonResult> => {
  const callable = httpsCallable<AbortLessonInput, AbortLessonResult>(functions, 'abortLessonCallable')
  const result = await callable(input)
  return result.data
}
