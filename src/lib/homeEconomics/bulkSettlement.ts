import { httpsCallable, type Functions } from 'firebase/functions'

/**
 * Task 6: generalized to `CANCELLED` (added alongside the existing
 * PENDING/RUNNING/FAILED/COMPLETED) and per-item `teamId`/`profileId` — see
 * `functions/src/homeEconomics/bulkSettlementOperation.ts`'s
 * `HouseholdBulkSettlementStatus`/`HouseholdBulkItem` for the server-side
 * source of truth this client type mirrors.
 */
export type HouseholdBulkSettlementStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED' | 'CANCELLED'

export interface HouseholdBulkItem {
  teamId: string
  profileId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  errorCode?: string
  errorMessage?: string
}

export interface HouseholdBulkSettlementOperationView {
  operationId: string
  /** Not present on the server's actual `toHouseholdBulkSettlementOperationView()` output — kept optional here only for pre-existing call-site compatibility. */
  lessonRunId?: string
  actorUid?: string
  expectedRoundIndex: number
  restoreGeneration?: number
  forceUnsubmitted: boolean
  status: HouseholdBulkSettlementStatus
  leaseActive: boolean
  retryable: boolean
  preSettlementCheckpointId: string | null
  attempt?: number
  households: Record<string, HouseholdBulkItem>
  createdAtServerMillis?: number
  updatedAtServerMillis: number
}

export interface ProcessHouseholdRoundBatchInput {
  lessonRunId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  idempotencyKey: string
}

export interface RetryHouseholdRoundBatchInput {
  lessonRunId: string
  operationId: string
}

export const processHouseholdRoundBatch = async (
  functions: Functions,
  input: ProcessHouseholdRoundBatchInput,
): Promise<HouseholdBulkSettlementOperationView> => {
  const callable = httpsCallable<ProcessHouseholdRoundBatchInput, HouseholdBulkSettlementOperationView>(
    functions,
    'processHouseholdRoundBatchCallable',
  )
  const result = await callable(input)
  return result.data
}

export const retryHouseholdRoundBatch = async (
  functions: Functions,
  input: RetryHouseholdRoundBatchInput,
): Promise<HouseholdBulkSettlementOperationView> => {
  const callable = httpsCallable<RetryHouseholdRoundBatchInput, HouseholdBulkSettlementOperationView>(
    functions,
    'retryHouseholdRoundBatchCallable',
  )
  const result = await callable(input)
  return result.data
}
