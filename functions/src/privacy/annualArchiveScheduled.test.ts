import { beforeEach, describe, expect, it } from 'vitest'
import {
  runDueAnnualArchiveJobs,
  type AnnualArchiveScheduledDeps,
} from './annualArchiveScheduled'
import type { AnnualArchiveJob } from './annualArchive'

describe('annualArchiveScheduled', () => {
  const docs = new Map<string, Record<string, unknown>>()
  const auditLogs: Array<Record<string, unknown>> = []

  const makeDeps = (now = new Date('2026-08-20T10:00:00Z')): AnnualArchiveScheduledDeps => ({
    now: () => now,
    db: {
      collection: (path: string) => {
        const createQuery = (filters: Array<{ field: string; op: string; val: unknown }>, limitCount?: number) => ({
          where: (f: string, o: string, v: unknown) => createQuery([...filters, { field: f, op: o, val: v }], limitCount),
          limit: (n: number) => createQuery(filters, n),
          get: async () => {
            const prefix = path + '/'
            let matched = [...docs.entries()]
              .filter(([p]) => p.startsWith(prefix))
              .map(([p, d]) => ({ id: p.split('/').pop()!, path: p, data: () => d }))

            for (const filter of filters) {
              if (filter.op === '==') {
                matched = matched.filter((d) => d.data()[filter.field] === filter.val)
              } else if (filter.op === '<=') {
                matched = matched.filter((d) => {
                  const val = d.data()[filter.field]
                  return typeof val === 'string' && val <= (filter.val as string)
                })
              } else if (filter.op === 'in') {
                matched = matched.filter((d) => {
                  const val = d.data()[filter.field]
                  return Array.isArray(filter.val) && (filter.val as unknown[]).includes(val)
                })
              }
            }
            if (limitCount !== undefined) {
              matched = matched.slice(0, limitCount)
            }
            return {
              empty: matched.length === 0,
              docs: matched,
            }
          },
        })
        return {
          where: (f: string, o: string, v: unknown) => createQuery([{ field: f, op: o, val: v }]),
          doc: (id?: string) => {
            const docPath = id ? `${path}/${id}` : `${path}/auto-${Math.random()}`
            return {
              id: docPath.split('/').pop()!,
              path: docPath,
              get: async () => {
                const data = docs.get(docPath)
                return { exists: !!data, data: () => data }
              },
              set: async (data: Record<string, unknown>) => {
                docs.set(docPath, data)
              },
            }
          },
        }
      },
      doc: (path: string) => ({
        id: path.split('/').pop()!,
        path,
        get: async () => {
          const data = docs.get(path)
          return { exists: !!data, data: () => data }
        },
        set: async (data: Record<string, unknown>) => {
          docs.set(path, data)
        },
      }),
      collectionGroup: (group: string) => {
        const createGroupQuery = (filters: Array<{ field: string; op: string; val: unknown }>) => ({
          where: (f: string, o: string, v: unknown) => createGroupQuery([...filters, { field: f, op: o, val: v }]),
          get: async () => {
            let matched = [...docs.entries()]
              .filter(([p]) => p.includes(`/${group}/`))
              .map(([p, d]) => ({ id: p.split('/').pop()!, path: p, data: () => d }))

            for (const filter of filters) {
              if (filter.op === '==') {
                matched = matched.filter((d) => d.data()[filter.field] === filter.val)
              } else if (filter.op === '<=') {
                matched = matched.filter((d) => {
                  const val = d.data()[filter.field]
                  return typeof val === 'string' && val <= (filter.val as string)
                })
              } else if (filter.op === 'in') {
                matched = matched.filter((d) => {
                  const val = d.data()[filter.field]
                  return Array.isArray(filter.val) && (filter.val as unknown[]).includes(val)
                })
              }
            }
            return { empty: matched.length === 0, docs: matched }
          },
        })
        return {
          where: (f: string, o: string, v: unknown) => createGroupQuery([{ field: f, op: o, val: v }]),
        }
      },
      runTransaction: async <T>(fn: (tx: {
        get: (pathOrRef: string | { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
        set: (pathOrRef: string | { path: string }, data: Record<string, unknown>) => void
      }) => Promise<T>): Promise<T> => {
        const getPath = (p: string | { path: string }) => typeof p === 'string' ? p : p.path
        const tx = {
          get: async (pathOrRef: string | { path: string }) => {
            const path = getPath(pathOrRef)
            const data = docs.get(path)
            return { exists: !!data, data: () => data }
          },
          set: (pathOrRef: string | { path: string }, data: Record<string, unknown>) => {
            const path = getPath(pathOrRef)
            if (path.includes('/auditLog/')) {
              auditLogs.push(data)
            }
            docs.set(path, data)
          },
        }
        return fn(tx)
      },
    },
  })

  beforeEach(() => {
    docs.clear()
    auditLogs.length = 0
  })

  it('does not process future SCHEDULED jobs', async () => {
    const deps = makeDeps(new Date('2026-08-15T10:00:00Z'))
    const jobPath = 'organizations/org-1/annualArchiveJobs/job-future'
    docs.set(jobPath, {
      id: 'job-future',
      orgId: 'org-1',
      academicYear: 2025,
      status: 'SCHEDULED',
      scheduledFor: '2026-08-20T00:00:00Z', // in the future
      archivedCount: 0,
      restoredCount: 0,
    })

    await runDueAnnualArchiveJobs(deps)
    const job = docs.get(jobPath) as unknown as AnnualArchiveJob
    expect(job.status).toBe('SCHEDULED')
  })

  it('acquires lease and completes archiving for due SCHEDULED jobs', async () => {
    const deps = makeDeps(new Date('2026-08-21T00:00:00Z'))
    const jobPath = 'organizations/org-1/annualArchiveJobs/job-due'
    docs.set(jobPath, {
      id: 'job-due',
      orgId: 'org-1',
      academicYear: 2025,
      periodStart: '2025-04-01T00:00:00+09:00',
      periodEnd: '2026-04-01T00:00:00+09:00',
      status: 'SCHEDULED',
      scheduledFor: '2026-08-20T00:00:00Z',
      reason: '年度アーカイブ',
      requestedByUid: 'owner-1',
      createdAt: '2026-08-15T00:00:00Z',
      archivedCount: 0,
      restoredCount: 0,
    })

    docs.set('lessonRuns/run-1', {
      id: 'run-1',
      orgId: 'org-1',
      status: 'COMPLETED',
      endedAt: '2025-06-01T10:00:00+09:00',
    })
    docs.set('lessonRuns/run-2', {
      id: 'run-2',
      orgId: 'org-1',
      status: 'ABORTED',
      endedAt: '2025-07-01T10:00:00+09:00',
    })

    await runDueAnnualArchiveJobs(deps)

    const job = docs.get(jobPath) as unknown as AnnualArchiveJob
    expect(job.status).toBe('COMPLETED')
    expect(job.archivedCount).toBe(2)
    expect(docs.get('lessonRuns/run-1')!.status).toBe('ARCHIVED')
    expect(docs.get('lessonRuns/run-2')!.status).toBe('ARCHIVED')

    // Check audit log
    const completeAudit = auditLogs.find((l) => l.action === 'COMPLETE_ANNUAL_ARCHIVE')
    expect(completeAudit).toBeDefined()
    expect(completeAudit!.result).toBe('SUCCESS')
  })

  it('does not acquire a job with an active valid lease', async () => {
    const deps = makeDeps(new Date('2026-08-21T00:00:00Z'))
    const jobPath = 'organizations/org-1/annualArchiveJobs/job-running'
    docs.set(jobPath, {
      id: 'job-running',
      orgId: 'org-1',
      academicYear: 2025,
      status: 'RUNNING',
      leaseOwner: 'worker-1',
      leaseUntil: '2026-08-21T00:10:00Z', // valid for another 10 mins
      archivedCount: 0,
      restoredCount: 0,
    })

    await runDueAnnualArchiveJobs(deps)
    const job = docs.get(jobPath) as unknown as AnnualArchiveJob
    expect(job.leaseOwner).toBe('worker-1')
  })

  it('re-acquires an expired lease on a RUNNING or FAILED job and resumes progress', async () => {
    const deps = makeDeps(new Date('2026-08-21T00:15:00Z'))
    const jobPath = 'organizations/org-1/annualArchiveJobs/job-stalled'
    docs.set(jobPath, {
      id: 'job-stalled',
      orgId: 'org-1',
      academicYear: 2025,
      periodStart: '2025-04-01T00:00:00+09:00',
      periodEnd: '2026-04-01T00:00:00+09:00',
      status: 'FAILED',
      scheduledFor: '2026-08-20T00:00:00Z',
      reason: '再試行テスト',
      leaseOwner: 'worker-old',
      leaseUntil: '2026-08-21T00:10:00Z', // expired
      archivedCount: 1,
      restoredCount: 0,
    })

    // run-1 was already archived
    docs.set('lessonRuns/run-1', {
      id: 'run-1',
      orgId: 'org-1',
      status: 'ARCHIVED',
      archiveJobId: 'job-stalled',
      endedAt: '2025-06-01T10:00:00+09:00',
    })
    // run-2 still needs to be archived
    docs.set('lessonRuns/run-2', {
      id: 'run-2',
      orgId: 'org-1',
      status: 'COMPLETED',
      endedAt: '2025-07-01T10:00:00+09:00',
    })

    await runDueAnnualArchiveJobs(deps)

    const job = docs.get(jobPath) as unknown as AnnualArchiveJob
    expect(job.status).toBe('COMPLETED')
    expect(job.archivedCount).toBe(2)
    expect(docs.get('lessonRuns/run-2')!.status).toBe('ARCHIVED')
  })

  it('processes CANCELLING jobs by rolling back all archived runs and setting CANCELLED', async () => {
    const deps = makeDeps(new Date('2026-08-21T00:00:00Z'))
    const jobPath = 'organizations/org-1/annualArchiveJobs/job-cancel'
    docs.set(jobPath, {
      id: 'job-cancel',
      orgId: 'org-1',
      academicYear: 2025,
      status: 'CANCELLING',
      scheduledFor: '2026-08-20T00:00:00Z',
      reason: '取消',
      archivedCount: 2,
      restoredCount: 0,
    })

    docs.set('lessonRuns/run-1', {
      id: 'run-1',
      orgId: 'org-1',
      status: 'ARCHIVED',
      archiveJobId: 'job-cancel',
      archivedAcademicYear: 2025,
      archivedFromStatus: 'COMPLETED',
      endedAt: '2025-06-01T10:00:00+09:00',
    })
    docs.set('lessonRuns/run-2', {
      id: 'run-2',
      orgId: 'org-1',
      status: 'ARCHIVED',
      archiveJobId: 'job-cancel',
      archivedAcademicYear: 2025,
      archivedFromStatus: 'ABORTED',
      endedAt: '2025-07-01T10:00:00+09:00',
    })

    await runDueAnnualArchiveJobs(deps)

    const job = docs.get(jobPath) as unknown as AnnualArchiveJob
    expect(job.status).toBe('CANCELLED')
    expect(job.restoredCount).toBe(2)
    expect(docs.get('lessonRuns/run-1')!.status).toBe('COMPLETED')
    expect(docs.get('lessonRuns/run-2')!.status).toBe('ABORTED')

    const cancelAudit = auditLogs.find((l) => l.action === 'CANCEL_ANNUAL_ARCHIVE_COMPLETED')
    expect(cancelAudit).toBeDefined()
    expect(cancelAudit!.result).toBe('SUCCESS')
  })
})

