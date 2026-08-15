import { httpsCallable, type Functions } from 'firebase/functions'

export interface WriteHouseholdCheckpointInput {
  lessonRunId: string
  label: string
  idempotencyKey: string
}

export interface WriteHouseholdCheckpointResult {
  checkpointId: string
  created: boolean
}

export interface RestoreHouseholdCheckpointInput {
  lessonRunId: string
  checkpointId: string
  reason: string
  idempotencyKey: string
}

export interface RestoreHouseholdCheckpointResult {
  newRestoreGeneration: number
  restoredHouseholdIds: string[]
  preRestoreCheckpointId: string
}

export const writeHouseholdCheckpoint = async (
  functions: Functions,
  input: WriteHouseholdCheckpointInput,
): Promise<WriteHouseholdCheckpointResult> => {
  const callable = httpsCallable<WriteHouseholdCheckpointInput, WriteHouseholdCheckpointResult>(
    functions,
    'writeHouseholdCheckpointCallable',
  )
  const result = await callable(input)
  return result.data
}

export const restoreHouseholdCheckpoint = async (
  functions: Functions,
  input: RestoreHouseholdCheckpointInput,
): Promise<RestoreHouseholdCheckpointResult> => {
  const callable = httpsCallable<RestoreHouseholdCheckpointInput, RestoreHouseholdCheckpointResult>(
    functions,
    'restoreHouseholdCheckpointCallable',
  )
  const result = await callable(input)
  return result.data
}
