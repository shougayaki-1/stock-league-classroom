import { httpsCallable, type Functions } from 'firebase/functions'

export interface GenerateLessonResultInput {
  lessonRunId: string
  phaseId: string
  idempotencyKey: string
  externalTaskUrl?: string
  externalResultUrl?: string
}

export interface GenerateLessonResultResult {
  resultId: string
  deduplicated: boolean
}

export const generateLessonResult = async (functions: Functions, input: GenerateLessonResultInput): Promise<GenerateLessonResultResult> => {
  const callable = httpsCallable<GenerateLessonResultInput, GenerateLessonResultResult>(functions, 'generateLessonResultCallable')
  const result = await callable(input)
  return result.data
}

export interface GetMyLessonResultInput {
  lessonRunId: string
}

export interface GetMyLessonResultItem {
  responseId: string
  scope: 'participant' | 'team'
  displayValue: string
  decisionExplanation: { whatHappened: string; whyItHappened: string; alternative: string; nextAction: string }
}

export interface GetMyLessonResultResult {
  found: boolean
  lessonRunId: string
  externalTaskUrl?: string
  externalResultUrl?: string
  items: GetMyLessonResultItem[]
}

export const getMyLessonResult = async (functions: Functions, input: GetMyLessonResultInput): Promise<GetMyLessonResultResult> => {
  const callable = httpsCallable<GetMyLessonResultInput, GetMyLessonResultResult>(functions, 'getMyLessonResultCallable')
  const result = await callable(input)
  return result.data
}
