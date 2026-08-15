import { httpsCallable, type Functions } from 'firebase/functions'
import type { HouseholdBulkSettlementOperationView } from './teacherDashboard'

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
