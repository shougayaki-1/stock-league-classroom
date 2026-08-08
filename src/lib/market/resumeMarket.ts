import { httpsCallable, type Functions } from 'firebase/functions'

export interface ResumeMarketInput {
  lessonRunId: string
  /** spec §12.26: teacher-configurable re-confirmation window in seconds;
   * omitted defaults to the callable's standard 30 seconds. `0` requests
   * the "確認なしの即時再開" immediate-resume path. */
  confirmationSeconds?: number
}

/** Client wrapper for resumeMarketCallable (teacher-only) — spec §12.26. */
export const resumeMarket = async (functions: Functions, input: ResumeMarketInput): Promise<void> => {
  const callable = httpsCallable<ResumeMarketInput, void>(functions, 'resumeMarketCallable')
  await callable(input)
}
