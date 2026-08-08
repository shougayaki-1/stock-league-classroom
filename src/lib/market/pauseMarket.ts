import { httpsCallable, type Functions } from 'firebase/functions'

export interface PauseMarketInput {
  lessonRunId: string
}

/** Client wrapper for pauseMarketCallable (teacher-only) — spec §12.25. */
export const pauseMarket = async (functions: Functions, input: PauseMarketInput): Promise<void> => {
  const callable = httpsCallable<PauseMarketInput, void>(functions, 'pauseMarketCallable')
  await callable(input)
}
