import { httpsCallable, type Functions } from 'firebase/functions'

export interface RestoreCheckpointInput {
  lessonRunId: string
  checkpointId: string
  reason: string
  idempotencyKey: string
}

export interface RestoreCheckpointResult {
  newRestoreGeneration: number
  eventId: string
  deduplicated: boolean
}

/**
 * Client wrapper for the restoreCheckpointCallable Callable. `actorId` and
 * `orgId` are resolved server-side from the caller's auth token and the
 * run's own stored orgId respectively — the client never supplies or
 * receives them.
 */
export const restoreCheckpoint = async (functions: Functions, input: RestoreCheckpointInput): Promise<RestoreCheckpointResult> => {
  const callable = httpsCallable<RestoreCheckpointInput, RestoreCheckpointResult>(functions, 'restoreCheckpointCallable')
  const result = await callable(input)
  return result.data
}
