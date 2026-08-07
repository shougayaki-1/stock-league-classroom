import { httpsCallable, type Functions } from 'firebase/functions'
import type { ScheduleSensitiveSettings } from './types'

export interface DuplicateLessonTemplateInput {
  sourceTemplateId: string
  sourceVersionId: string
  targetOrgId: string
  confirmedOverrides: Partial<ScheduleSensitiveSettings>
  idempotencyKey: string
}

export interface DuplicateLessonTemplateResult {
  templateId: string
  alreadyDuplicated: boolean
}

/**
 * Client wrapper for the duplicateLessonTemplateCallable Callable. Input is
 * limited to what the client actually knows — the caller's uid and the
 * source template's own org are resolved server-side, never sent by the
 * client.
 */
export const duplicateLessonTemplate = async (functions: Functions, input: DuplicateLessonTemplateInput): Promise<DuplicateLessonTemplateResult> => {
  const call = httpsCallable<DuplicateLessonTemplateInput, DuplicateLessonTemplateResult>(functions, 'duplicateLessonTemplateCallable')
  const result = await call(input)
  return result.data
}
