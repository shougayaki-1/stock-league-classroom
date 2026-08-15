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

export interface AnnualArchiveLessonRun {
  id: string
  orgId: string
  status: string
  endedAt?: string | null
  archiveJobId?: string
  archivedAcademicYear?: number
  archivedFromStatus?: 'COMPLETED' | 'ABORTED'
  archivedAt?: string
  [key: string]: unknown
}

export interface AcademicYearBounds {
  academicYear: number
  periodStart: string
  periodEnd: string
  startMs: number
  endMs: number
}

/**
 * 日本の学校年度の期間境界を計算する。
 * 4月1日 00:00:00 JST 以上、翌年4月1日 00:00:00 JST 未満。
 */
export const getAcademicYearBounds = (academicYear: number): AcademicYearBounds => {
  const periodStart = `${academicYear}-04-01T00:00:00+09:00`
  const periodEnd = `${academicYear + 1}-04-01T00:00:00+09:00`
  const startMs = new Date(periodStart).getTime()
  const endMs = new Date(periodEnd).getTime()
  return {
    academicYear,
    periodStart,
    periodEnd,
    startMs,
    endMs,
  }
}

export interface ArchiveTxDocRef {
  path: string
}

export interface ArchiveTx {
  get: (pathOrRef: string | ArchiveTxDocRef | FirebaseFirestore.DocumentReference) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (pathOrRef: string | ArchiveTxDocRef | FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => void
}

export type ArchiveRunResult =
  | { changed: true; previousStatus: 'COMPLETED' | 'ABORTED' }
  | { changed: false; reason: string }

export const archiveLessonRunForJob = async (
  tx: ArchiveTx,
  pathOrRef: string | FirebaseFirestore.DocumentReference,
  job: AnnualArchiveJob,
  nowIso?: string,
): Promise<ArchiveRunResult> => {
  const snap = await tx.get(pathOrRef)
  if (!snap.exists) {
    return { changed: false, reason: 'NOT_FOUND' }
  }

  const run = snap.data() as AnnualArchiveLessonRun | undefined
  if (!run) {
    return { changed: false, reason: 'EMPTY_DATA' }
  }

  if (run.status === 'ARCHIVED') {
    if (run.archiveJobId === job.id) {
      return { changed: false, reason: 'ALREADY_ARCHIVED_BY_SAME_JOB' }
    }
    return { changed: false, reason: 'ARCHIVED_BY_ANOTHER_JOB' }
  }

  if (run.status !== 'COMPLETED' && run.status !== 'ABORTED') {
    return { changed: false, reason: 'INVALID_STATUS' }
  }

  if (!run.endedAt) {
    return { changed: false, reason: 'MISSING_ENDED_AT' }
  }

  const bounds = getAcademicYearBounds(job.academicYear)
  const endedMs = new Date(run.endedAt).getTime()
  if (Number.isNaN(endedMs) || endedMs < bounds.startMs || endedMs >= bounds.endMs) {
    return { changed: false, reason: 'OUT_OF_BOUNDS' }
  }

  const archivedAt = nowIso ?? new Date().toISOString()
  const updatedRun: Record<string, unknown> = {
    ...run,
    status: 'ARCHIVED',
    archiveJobId: job.id,
    archivedAcademicYear: job.academicYear,
    archivedFromStatus: run.status,
    archivedAt,
  }

  tx.set(pathOrRef, updatedRun)
  return { changed: true, previousStatus: run.status as 'COMPLETED' | 'ABORTED' }
}

export type RollbackRunResult =
  | { changed: true; restoredStatus: 'COMPLETED' | 'ABORTED' }
  | { changed: false; reason: string }

export const rollbackLessonRunArchive = async (
  tx: ArchiveTx,
  pathOrRef: string | FirebaseFirestore.DocumentReference,
  jobId: string,
): Promise<RollbackRunResult> => {
  const snap = await tx.get(pathOrRef)
  if (!snap.exists) {
    return { changed: false, reason: 'NOT_FOUND' }
  }

  const run = snap.data() as AnnualArchiveLessonRun | undefined
  if (!run) {
    return { changed: false, reason: 'EMPTY_DATA' }
  }

  if (run.status !== 'ARCHIVED') {
    return { changed: false, reason: 'NOT_ARCHIVED' }
  }

  if (run.archiveJobId !== jobId) {
    return { changed: false, reason: 'JOB_MISMATCH' }
  }

  const restoredStatus = run.archivedFromStatus
  if (restoredStatus !== 'COMPLETED' && restoredStatus !== 'ABORTED') {
    throw new Error(`Invalid archivedFromStatus: ${String(restoredStatus)}`)
  }

  const updatedRun: Record<string, unknown> = { ...run, status: restoredStatus }
  delete updatedRun.archiveJobId
  delete updatedRun.archivedAcademicYear
  delete updatedRun.archivedFromStatus
  delete updatedRun.archivedAt

  tx.set(pathOrRef, updatedRun)
  return { changed: true, restoredStatus }
}
