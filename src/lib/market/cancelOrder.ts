import { httpsCallable, type Functions } from 'firebase/functions'

export interface CancelOrderInput {
  lessonRunId: string
  orderId: string
}

/**
 * Client wrapper for cancelOrderCallable — spec §12.17. `teamId` is not
 * sent: the server resolves the order's owning team from the order
 * document itself and verifies the caller is a member of that team,
 * matching submitOrder's "server re-validates scope" pattern.
 */
export const cancelOrder = async (functions: Functions, input: CancelOrderInput): Promise<void> => {
  const callable = httpsCallable<CancelOrderInput, void>(functions, 'cancelOrderCallable')
  await callable(input)
}
