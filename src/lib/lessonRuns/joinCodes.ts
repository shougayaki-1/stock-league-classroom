import { httpsCallable, type Functions } from 'firebase/functions'

export interface IssueJoinCodeInput {
  lessonRunId: string
}

export interface IssueJoinCodeResult {
  code: string
}

/**
 * Client wrapper for issueJoinCodeCallable (teacher-only — PRIMARY/ASSISTANT role on the run).
 */
export const issueJoinCode = async (
  functions: Functions,
  input: IssueJoinCodeInput,
): Promise<IssueJoinCodeResult> => {
  const callable = httpsCallable<IssueJoinCodeInput, IssueJoinCodeResult>(functions, 'issueJoinCodeCallable')
  const result = await callable(input)
  return result.data
}

export interface InvalidateJoinCodeInput {
  lessonRunId: string
  code: string
}

export interface InvalidateJoinCodeResult {
  success: true
}

/**
 * Client wrapper for invalidateJoinCodeCallable (teacher-only — PRIMARY/ASSISTANT role on the run).
 */
export const invalidateJoinCode = async (
  functions: Functions,
  input: InvalidateJoinCodeInput,
): Promise<InvalidateJoinCodeResult> => {
  const callable = httpsCallable<InvalidateJoinCodeInput, InvalidateJoinCodeResult>(functions, 'invalidateJoinCodeCallable')
  const result = await callable(input)
  return result.data
}
