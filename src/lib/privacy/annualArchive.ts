import { httpsCallable, type Functions } from 'firebase/functions'

export type AnnualArchiveJobStatus =
  | 'SCHEDULED'
  | 'RUNNING'
  | 'CANCELLING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'

export interface AnnualArchiveJob {
  id: string
  orgId: string
  academicYear: number
  periodStart: string
  periodEnd: string
  status: AnnualArchiveJobStatus
  scheduledFor: string
  reason: string
  requestedByUid: string
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  cancelRequestedAt?: string | null
  cancelledAt?: string | null
  archivedCount: number
  restoredCount: number
  lastError?: string | null
  leaseOwner?: string | null
  leaseUntil?: string | null
}

export interface PreviewAnnualArchiveInput {
  orgId: string
  academicYear: number
}

export interface PreviewAnnualArchiveResult {
  academicYear: number
  periodStart: string
  periodEnd: string
  eligibleCount: number
  missingEndedAtCount: number
}

export interface ScheduleAnnualArchiveInput {
  orgId: string
  academicYear: number
  scheduledFor: string
  reason: string
  idempotencyKey: string
}

export interface ScheduleAnnualArchiveResult {
  job: AnnualArchiveJob
  deduplicated: boolean
}

export interface CancelAnnualArchiveInput {
  orgId: string
  jobId: string
  reason: string
  idempotencyKey: string
}

export interface CancelAnnualArchiveResult {
  job: AnnualArchiveJob
  deduplicated: boolean
}

export interface ListAnnualArchiveJobsInput {
  orgId: string
}

export interface ListAnnualArchiveJobsResult {
  jobs: AnnualArchiveJob[]
}

export const previewAnnualArchive = async (
  functions: Functions,
  input: PreviewAnnualArchiveInput,
): Promise<PreviewAnnualArchiveResult> =>
  (
    await httpsCallable<PreviewAnnualArchiveInput, PreviewAnnualArchiveResult>(
      functions,
      'previewAnnualArchiveCallable',
    )(input)
  ).data

export const scheduleAnnualArchive = async (
  functions: Functions,
  input: ScheduleAnnualArchiveInput,
): Promise<ScheduleAnnualArchiveResult> =>
  (
    await httpsCallable<ScheduleAnnualArchiveInput, ScheduleAnnualArchiveResult>(
      functions,
      'scheduleAnnualArchiveCallable',
    )(input)
  ).data

export const cancelAnnualArchive = async (
  functions: Functions,
  input: CancelAnnualArchiveInput,
): Promise<CancelAnnualArchiveResult> =>
  (
    await httpsCallable<CancelAnnualArchiveInput, CancelAnnualArchiveResult>(
      functions,
      'cancelAnnualArchiveCallable',
    )(input)
  ).data

export const listAnnualArchiveJobs = async (
  functions: Functions,
  input: ListAnnualArchiveJobsInput,
): Promise<ListAnnualArchiveJobsResult> =>
  (
    await httpsCallable<ListAnnualArchiveJobsInput, ListAnnualArchiveJobsResult>(
      functions,
      'listAnnualArchiveJobsCallable',
    )(input)
  ).data
