import { httpsCallable, type Functions } from 'firebase/functions'

export interface CreateLessonRunInput {
  templateId: string
  lessonRunIdempotencyKey: string
}

export interface CreateLessonRunResult {
  lessonRunId: string
  created: boolean
}

/**
 * Client wrapper for the createLessonRunCallable Callable. Input is limited
 * to what the client actually knows — orgId and randomSeed are resolved and
 * generated server-side and are never sent by or returned as client-chosen
 * values.
 */
export const createLessonRun = async (functions: Functions, input: CreateLessonRunInput): Promise<CreateLessonRunResult> => {
  const callable = httpsCallable<CreateLessonRunInput, CreateLessonRunResult>(functions, 'createLessonRunCallable')
  const result = await callable(input)
  return result.data
}
