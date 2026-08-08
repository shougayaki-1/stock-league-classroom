import { httpsCallable, type Functions } from 'firebase/functions'

export interface SubmitOrderInput {
  lessonRunId: string
  batchId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  idempotencyKey: string
}

export interface SubmitOrderResult {
  orderId: string
  created: boolean
}

/**
 * Client wrapper for submitOrderCallable. `teamId` is sent as a request
 * field but the server independently verifies the caller is a member of
 * that team (via the participant's server-resolved identity) before
 * acting on it — the client cannot spoof another team's orders by
 * supplying a different teamId, matching every other Phase B Callable's
 * "server re-validates scope" pattern (e.g. transitionPhase.ts).
 */
export const submitOrder = async (functions: Functions, input: SubmitOrderInput): Promise<SubmitOrderResult> => {
  const callable = httpsCallable<SubmitOrderInput, SubmitOrderResult>(functions, 'submitOrderCallable')
  const result = await callable(input)
  return result.data
}
