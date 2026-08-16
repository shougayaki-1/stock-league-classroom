import { httpsCallable, type Functions } from 'firebase/functions'

export interface WriteHouseholdCheckpointInput {
  lessonRunId: string
  label: string
  idempotencyKey: string
}

export interface WriteHouseholdCheckpointResult {
  checkpointId: string
  created: boolean
  /**
   * Which checkpoint codec the server used to write this checkpoint — `2`
   * for a Common-only (COMMON_CONDITIONS) `HouseholdCheckpointSnapshotV2`,
   * `3` for an advanced-format (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM)
   * `HouseholdCheckpointSnapshotV3` — see `functions/src/homeEconomics/householdCheckpoint.ts`.
   * Optional: legacy v1 writes and any caller that doesn't need to
   * distinguish the two schemas can ignore it.
   */
  schemaVersion?: 2 | 3
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
  /**
   * Which checkpoint codec the server dispatched to for this restore — `2`
   * for Common-only (v2), `3` for advanced-format (v3). See
   * `functions/src/homeEconomics/householdRestore.ts`'s
   * `HouseholdRestoreOperationView`. Optional so older cached results/tests
   * that predate this field keep compiling.
   */
  schemaVersion?: 2 | 3
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
