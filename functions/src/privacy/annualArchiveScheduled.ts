import { getFirestore } from 'firebase-admin/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import {
  archiveLessonRunForJob,
  rollbackLessonRunArchive,
  type AnnualArchiveJob,
} from './annualArchive'
import { recordAuditLogInTransaction } from './auditLog'

export const ANNUAL_ARCHIVE_PAGE_SIZE = 100
export const LEASE_DURATION_MS = 5 * 60 * 1000

export interface FirestoreQueryDoc {
  id: string
  path: string
  data: () => Record<string, unknown>
}

export interface FirestoreQuery {
  where: (field: string, op: string, val: unknown) => FirestoreQuery
  limit?: (n: number) => FirestoreQuery
  get: () => Promise<{ empty: boolean; docs: FirestoreQueryDoc[] }>
}

export interface ScheduledTx {
  get: (pathOrRef: string | { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (pathOrRef: string | { path: string }, data: Record<string, unknown>) => void
}

export interface ScheduledDb {
  collection: (path: string) => {
    where: (field: string, op: string, val: unknown) => FirestoreQuery
    doc: (id?: string) => { id: string; path: string; get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (data: Record<string, unknown>) => Promise<void> }
  }
  doc: (path: string) => { id: string; path: string; get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (data: Record<string, unknown>) => Promise<void> }
  collectionGroup: (group: string) => {
    where: (field: string, op: string, val: unknown) => FirestoreQuery
  }
  runTransaction: <T>(fn: (tx: ScheduledTx) => Promise<T>) => Promise<T>
}

export interface AnnualArchiveScheduledDeps {
  db: ScheduledDb
  now?: () => Date
  workerId?: string
}

export const isLeaseExpired = (leaseUntil: string | null | undefined, now: Date): boolean => {
  if (!leaseUntil) return true
  return new Date(leaseUntil).getTime() <= now.getTime()
}

/**
 * Executes a single annual archive job (either archiving or cancelling/rolling back).
 */
export const runAnnualArchiveJob = async (
  deps: AnnualArchiveScheduledDeps,
  jobPath: string,
): Promise<{ success: boolean; status: string }> => {
  const now = (deps.now ?? (() => new Date()))()
  const nowIso = now.toISOString()
  const workerId = deps.workerId ?? `worker-${Math.random().toString(36).slice(2)}`
  const leaseUntilIso = new Date(now.getTime() + LEASE_DURATION_MS).toISOString()

  // 1. Acquire Lease
  const leaseAcquired = await deps.db.runTransaction(async (tx) => {
    const jobSnap = await tx.get({ path: jobPath })
    if (!jobSnap.exists) return null

    const job = jobSnap.data() as unknown as AnnualArchiveJob
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      return null
    }

    if (job.status === 'SCHEDULED') {
      if (new Date(job.scheduledFor).getTime() > now.getTime()) {
        return null
      }
      const updated: AnnualArchiveJob = {
        ...job,
        status: 'RUNNING',
        startedAt: job.startedAt ?? nowIso,
        leaseOwner: workerId,
        leaseUntil: leaseUntilIso,
      }
      tx.set({ path: jobPath }, updated as unknown as Record<string, unknown>)
      return updated
    }

    if (job.status === 'RUNNING' || job.status === 'FAILED' || job.status === 'CANCELLING') {
      if (!isLeaseExpired(job.leaseUntil, now) && job.leaseOwner !== workerId) {
        return null
      }
      const updated: AnnualArchiveJob = {
        ...job,
        status: job.status === 'FAILED' ? 'RUNNING' : job.status,
        leaseOwner: workerId,
        leaseUntil: leaseUntilIso,
      }
      tx.set({ path: jobPath }, updated as unknown as Record<string, unknown>)
      return updated
    }

    return null
  })

  if (!leaseAcquired) {
    return { success: false, status: 'SKIPPED' }
  }

  const currentJob = leaseAcquired

  // 2. Process based on Status
  if (currentJob.status === 'CANCELLING') {
    // ---- CANCELLING (Rollback) Flow ----
    try {
      let restoredCount = currentJob.restoredCount ?? 0
      while (true) {
        const query = deps.db.collection('lessonRuns')
          .where('orgId', '==', currentJob.orgId)
          .where('status', '==', 'ARCHIVED')
          .where('archiveJobId', '==', currentJob.id)

        const snap = await (query.limit ? query.limit(ANNUAL_ARCHIVE_PAGE_SIZE) : query).get()
        if (snap.empty || snap.docs.length === 0) {
          break
        }

        for (const doc of snap.docs) {
          const runResult = await deps.db.runTransaction(async (tx) => {
            return await rollbackLessonRunArchive(tx, doc.path, currentJob.id)
          })
          if (runResult.changed) {
            restoredCount++
          }
        }

        // update intermediate job progress
        await deps.db.runTransaction(async (tx) => {
          const jSnap = await tx.get({ path: jobPath })
          if (jSnap.exists) {
            tx.set({ path: jobPath }, { ...(jSnap.data() as object), restoredCount })
          }
        })
      }

      // Complete rollback
      await deps.db.runTransaction(async (tx) => {
        const jSnap = await tx.get({ path: jobPath })
        if (!jSnap.exists) return
        const latestJob = jSnap.data() as unknown as AnnualArchiveJob
        const updated: AnnualArchiveJob = {
          ...latestJob,
          status: 'CANCELLED',
          cancelledAt: nowIso,
          leaseOwner: null,
          leaseUntil: null,
          restoredCount,
        }
        tx.set({ path: jobPath }, updated as unknown as Record<string, unknown>)
        recordAuditLogInTransaction(tx, deps.db as never, {
          orgId: currentJob.orgId,
          actorUid: 'system:scheduler',
          action: 'CANCEL_ANNUAL_ARCHIVE_COMPLETED',
          result: 'SUCCESS',
          reason: latestJob.reason,
          after: {
            jobId: currentJob.id,
            academicYear: currentJob.academicYear,
            restoredCount,
          },
        })
      })

      return { success: true, status: 'CANCELLED' }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      await deps.db.runTransaction(async (tx) => {
        const jSnap = await tx.get({ path: jobPath })
        if (jSnap.exists) {
          tx.set({ path: jobPath }, { ...(jSnap.data() as object), lastError: errMsg, leaseOwner: null, leaseUntil: null })
        }
      })
      return { success: false, status: 'FAILED' }
    }
  }

  // ---- RUNNING (Archive) Flow ----
  try {
    let archivedCount = currentJob.archivedCount ?? 0
    while (true) {
      const query = deps.db.collection('lessonRuns')
        .where('orgId', '==', currentJob.orgId)
        .where('status', 'in', ['COMPLETED', 'ABORTED'])

      const snap = await (query.limit ? query.limit(ANNUAL_ARCHIVE_PAGE_SIZE) : query).get()
      if (snap.empty || snap.docs.length === 0) {
        break
      }

      let processedInPage = 0
      for (const doc of snap.docs) {
        // Check if job was cancelled mid-flight
        const jobCheck = await deps.db.runTransaction(async (tx) => {
          const jSnap = await tx.get({ path: jobPath })
          return jSnap.exists ? (jSnap.data() as unknown as AnnualArchiveJob) : null
        })
        if (jobCheck && jobCheck.status === 'CANCELLING') {
          // Hand off to CANCELLING on next turn
          return { success: true, status: 'CANCELLING' }
        }

        const runResult = await deps.db.runTransaction(async (tx) => {
          return await archiveLessonRunForJob(tx, doc.path, currentJob, nowIso)
        })

        if (runResult.changed) {
          archivedCount++
          processedInPage++
        }
      }

      if (processedInPage === 0) {
        // No runs were archived in this page (e.g. all out of academic bounds)
        break
      }

      // update intermediate progress
      await deps.db.runTransaction(async (tx) => {
        const jSnap = await tx.get({ path: jobPath })
        if (jSnap.exists) {
          tx.set({ path: jobPath }, { ...(jSnap.data() as object), archivedCount })
        }
      })
    }

    // Complete archive
    const finalResult = await deps.db.runTransaction(async (tx) => {
      const jSnap = await tx.get({ path: jobPath })
      if (!jSnap.exists) return 'NOT_FOUND'
      const latestJob = jSnap.data() as unknown as AnnualArchiveJob

      if (latestJob.status === 'CANCELLING') {
        return 'CANCELLING'
      }

      const updated: AnnualArchiveJob = {
        ...latestJob,
        status: 'COMPLETED',
        completedAt: nowIso,
        leaseOwner: null,
        leaseUntil: null,
        archivedCount,
      }
      tx.set({ path: jobPath }, updated as unknown as Record<string, unknown>)
      recordAuditLogInTransaction(tx, deps.db as never, {
        orgId: currentJob.orgId,
        actorUid: 'system:scheduler',
        action: 'COMPLETE_ANNUAL_ARCHIVE',
        result: 'SUCCESS',
        reason: latestJob.reason,
        after: {
          jobId: currentJob.id,
          academicYear: currentJob.academicYear,
          archivedCount,
        },
      })
      return 'COMPLETED'
    })

    return { success: true, status: finalResult }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    await deps.db.runTransaction(async (tx) => {
      const jSnap = await tx.get({ path: jobPath })
      if (jSnap.exists) {
        const latest = jSnap.data() as unknown as AnnualArchiveJob
        tx.set({ path: jobPath }, { ...(latest as object), status: 'FAILED', lastError: errMsg, leaseOwner: null, leaseUntil: null })
        recordAuditLogInTransaction(tx, deps.db as never, {
          orgId: currentJob.orgId,
          actorUid: 'system:scheduler',
          action: 'FAIL_ANNUAL_ARCHIVE',
          result: 'FAILURE',
          reason: errMsg,
          after: {
            jobId: currentJob.id,
            academicYear: currentJob.academicYear,
          },
        })
      }
    })
    return { success: false, status: 'FAILED' }
  }
}

/**
 * Sweeps all pending/due/resumable annual archive jobs across organizations.
 */
export const runDueAnnualArchiveJobs = async (
  deps: AnnualArchiveScheduledDeps,
): Promise<{ processed: string[] }> => {
  const now = (deps.now ?? (() => new Date()))()
  const nowIso = now.toISOString()
  const processed: string[] = []

  // Find SCHEDULED jobs that are due
  const scheduledSnap = await deps.db.collectionGroup('annualArchiveJobs')
    .where('status', '==', 'SCHEDULED')
    .where('scheduledFor', '<=', nowIso)
    .get()

  for (const doc of scheduledSnap.docs) {
    await runAnnualArchiveJob(deps, doc.path)
    processed.push(doc.path)
  }

  // Find RUNNING jobs (to check expired leases)
  const runningSnap = await deps.db.collectionGroup('annualArchiveJobs')
    .where('status', '==', 'RUNNING')
    .get()

  for (const doc of runningSnap.docs) {
    if (!processed.includes(doc.path)) {
      await runAnnualArchiveJob(deps, doc.path)
      processed.push(doc.path)
    }
  }

  // Find FAILED jobs
  const failedSnap = await deps.db.collectionGroup('annualArchiveJobs')
    .where('status', '==', 'FAILED')
    .get()

  for (const doc of failedSnap.docs) {
    if (!processed.includes(doc.path)) {
      await runAnnualArchiveJob(deps, doc.path)
      processed.push(doc.path)
    }
  }

  // Find CANCELLING jobs
  const cancellingSnap = await deps.db.collectionGroup('annualArchiveJobs')
    .where('status', '==', 'CANCELLING')
    .get()

  for (const doc of cancellingSnap.docs) {
    if (!processed.includes(doc.path)) {
      await runAnnualArchiveJob(deps, doc.path)
      processed.push(doc.path)
    }
  }

  return { processed }
}

/**
 * Production wiring: runs every 5 minutes on Cloud Scheduler.
 */
export const annualArchiveScheduled = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Asia/Tokyo', region: 'asia-northeast1' },
  async () => {
    const db = getFirestore()
    try {
      await runDueAnnualArchiveJobs({ db: db as unknown as ScheduledDb })
    } catch (error) {
      logger.error('annualArchiveScheduled sweep failed', error)
    }
  },
)
