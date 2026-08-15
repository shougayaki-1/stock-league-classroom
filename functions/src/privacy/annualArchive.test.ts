import { describe, expect, it } from 'vitest'
import {
  getAcademicYearBounds,
  archiveLessonRunForJob,
  rollbackLessonRunArchive,
  type AnnualArchiveJob,
} from './annualArchive'

const sampleJob: AnnualArchiveJob = {
  id: 'job-2025-1',
  orgId: 'org-1',
  academicYear: 2025,
  periodStart: '2025-04-01T00:00:00+09:00',
  periodEnd: '2026-04-01T00:00:00+09:00',
  status: 'RUNNING',
  scheduledFor: '2026-08-15T00:00:00Z',
  reason: '2025年度アーカイブ',
  requestedByUid: 'owner-1',
  createdAt: '2026-08-15T00:00:00Z',
  archivedCount: 0,
  restoredCount: 0,
}

const makeTxFake = (initialDocs: Record<string, Record<string, unknown>>) => {
  const docs = new Map<string, Record<string, unknown>>()
  for (const [k, v] of Object.entries(initialDocs)) {
    docs.set(k, { ...v })
  }
  const getDocPath = (pathOrRef: string | { path: string } | unknown): string => {
    if (typeof pathOrRef === 'string') return pathOrRef
    if (pathOrRef && typeof pathOrRef === 'object' && 'path' in pathOrRef) {
      return (pathOrRef as { path: string }).path
    }
    return String(pathOrRef)
  }
  return {
    docs,
    tx: {
      get: async (pathOrRef: string | { path: string } | unknown) => {
        const path = getDocPath(pathOrRef)
        const d = docs.get(path)
        return { exists: !!d, data: () => d }
      },
      set: (pathOrRef: string | { path: string } | unknown, data: Record<string, unknown>) => {
        const path = getDocPath(pathOrRef)
        docs.set(path, data)
      },
    },
  }
}

describe('getAcademicYearBounds', () => {
  it('calculates academic year bounds in JST (April 1 00:00:00 JST to April 1 00:00:00 JST next year)', () => {
    const bounds2025 = getAcademicYearBounds(2025)
    expect(bounds2025.academicYear).toBe(2025)
    expect(bounds2025.periodStart).toBe('2025-04-01T00:00:00+09:00')
    expect(bounds2025.periodEnd).toBe('2026-04-01T00:00:00+09:00')
    // Check Date conversion
    expect(new Date(bounds2025.periodStart).toISOString()).toBe('2025-03-31T15:00:00.000Z')
    expect(new Date(bounds2025.periodEnd).toISOString()).toBe('2026-03-31T15:00:00.000Z')
  })
})

describe('archiveLessonRunForJob', () => {
  it('archives a COMPLETED run whose endedAt is within academic year', async () => {
    const path = 'lessonRuns/run-1'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-1',
        orgId: 'org-1',
        status: 'COMPLETED',
        endedAt: '2025-06-01T10:00:00+09:00',
        extra: 'keep-me',
      },
    })

    const result = await archiveLessonRunForJob(tx, path, sampleJob, '2026-08-15T12:00:00Z')
    expect(result).toEqual({ changed: true, previousStatus: 'COMPLETED' })

    const updated = docs.get(path)!
    expect(updated.status).toBe('ARCHIVED')
    expect(updated.archiveJobId).toBe('job-2025-1')
    expect(updated.archivedAcademicYear).toBe(2025)
    expect(updated.archivedFromStatus).toBe('COMPLETED')
    expect(updated.archivedAt).toBe('2026-08-15T12:00:00Z')
    expect(updated.extra).toBe('keep-me')
  })

  it('archives an ABORTED run whose endedAt is within academic year', async () => {
    const path = 'lessonRuns/run-2'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-2',
        orgId: 'org-1',
        status: 'ABORTED',
        endedAt: '2026-03-31T23:59:59+09:00',
      },
    })

    const result = await archiveLessonRunForJob(tx, path, sampleJob, '2026-08-15T12:00:00Z')
    expect(result).toEqual({ changed: true, previousStatus: 'ABORTED' })

    const updated = docs.get(path)!
    expect(updated.status).toBe('ARCHIVED')
    expect(updated.archivedFromStatus).toBe('ABORTED')
  })

  it('does not archive runs with non-target statuses (e.g. WAITING, RUNNING, PAUSED, REFLECTION)', async () => {
    for (const status of ['DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'REFLECTION']) {
      const path = `lessonRuns/run-${status}`
      const { tx, docs } = makeTxFake({
        [path]: {
          id: `run-${status}`,
          orgId: 'org-1',
          status,
          endedAt: '2025-06-01T10:00:00+09:00',
        },
      })

      const result = await archiveLessonRunForJob(tx, path, sampleJob, '2026-08-15T12:00:00Z')
      expect(result).toEqual({ changed: false, reason: 'INVALID_STATUS' })
      expect(docs.get(path)!.status).toBe(status)
    }
  })

  it('does not archive runs with endedAt outside the academic year', async () => {
    const { tx, docs } = makeTxFake({
      'lessonRuns/run-before': {
        id: 'run-before',
        orgId: 'org-1',
        status: 'COMPLETED',
        endedAt: '2025-03-31T23:59:59+09:00', // 2024年度
      },
      'lessonRuns/run-after': {
        id: 'run-after',
        orgId: 'org-1',
        status: 'COMPLETED',
        endedAt: '2026-04-01T00:00:00+09:00', // 2026年度
      },
    })

    const r1 = await archiveLessonRunForJob(tx, 'lessonRuns/run-before', sampleJob, '2026-08-15T12:00:00Z')
    const r2 = await archiveLessonRunForJob(tx, 'lessonRuns/run-after', sampleJob, '2026-08-15T12:00:00Z')

    expect(r1).toEqual({ changed: false, reason: 'OUT_OF_BOUNDS' })
    expect(r2).toEqual({ changed: false, reason: 'OUT_OF_BOUNDS' })
    expect(docs.get('lessonRuns/run-before')!.status).toBe('COMPLETED')
    expect(docs.get('lessonRuns/run-after')!.status).toBe('COMPLETED')
  })

  it('does not archive runs with endedAt == null', async () => {
    const path = 'lessonRuns/run-null-ended'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-null-ended',
        orgId: 'org-1',
        status: 'COMPLETED',
        endedAt: null,
      },
    })

    const result = await archiveLessonRunForJob(tx, path, sampleJob, '2026-08-15T12:00:00Z')
    expect(result).toEqual({ changed: false, reason: 'MISSING_ENDED_AT' })
    expect(docs.get(path)!.status).toBe('COMPLETED')
  })

  it('is idempotent on retry for the same job (no-op)', async () => {
    const path = 'lessonRuns/run-already-archived'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-already-archived',
        orgId: 'org-1',
        status: 'ARCHIVED',
        endedAt: '2025-06-01T10:00:00+09:00',
        archiveJobId: 'job-2025-1',
        archivedAcademicYear: 2025,
        archivedFromStatus: 'COMPLETED',
        archivedAt: '2026-08-15T10:00:00Z',
      },
    })

    const result = await archiveLessonRunForJob(tx, path, sampleJob, '2026-08-15T12:00:00Z')
    expect(result).toEqual({ changed: false, reason: 'ALREADY_ARCHIVED_BY_SAME_JOB' })
    expect(docs.get(path)!.archivedAt).toBe('2026-08-15T10:00:00Z')
  })

  it('does not overwrite runs archived by a different job', async () => {
    const path = 'lessonRuns/run-other-job'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-other-job',
        orgId: 'org-1',
        status: 'ARCHIVED',
        endedAt: '2025-06-01T10:00:00+09:00',
        archiveJobId: 'other-job',
        archivedAcademicYear: 2025,
        archivedFromStatus: 'COMPLETED',
        archivedAt: '2026-08-14T10:00:00Z',
      },
    })

    const result = await archiveLessonRunForJob(tx, path, sampleJob, '2026-08-15T12:00:00Z')
    expect(result).toEqual({ changed: false, reason: 'ARCHIVED_BY_ANOTHER_JOB' })
    expect(docs.get(path)!.archiveJobId).toBe('other-job')
  })
})

describe('rollbackLessonRunArchive', () => {
  it('restores an ARCHIVED run to its archivedFromStatus when archiveJobId matches', async () => {
    const path = 'lessonRuns/run-to-rollback'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-to-rollback',
        orgId: 'org-1',
        status: 'ARCHIVED',
        archiveJobId: 'job-2025-1',
        archivedAcademicYear: 2025,
        archivedFromStatus: 'COMPLETED',
        archivedAt: '2026-08-15T10:00:00Z',
        extra: 'keep-me',
      },
    })

    const result = await rollbackLessonRunArchive(tx, path, 'job-2025-1')
    expect(result).toEqual({ changed: true, restoredStatus: 'COMPLETED' })

    const updated = docs.get(path)!
    expect(updated.status).toBe('COMPLETED')
    expect(updated.archiveJobId).toBeUndefined()
    expect(updated.archivedAcademicYear).toBeUndefined()
    expect(updated.archivedFromStatus).toBeUndefined()
    expect(updated.archivedAt).toBeUndefined()
    expect(updated.extra).toBe('keep-me')
  })

  it('restores an ABORTED run properly', async () => {
    const path = 'lessonRuns/run-aborted-rollback'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-aborted-rollback',
        orgId: 'org-1',
        status: 'ARCHIVED',
        archiveJobId: 'job-2025-1',
        archivedAcademicYear: 2025,
        archivedFromStatus: 'ABORTED',
        archivedAt: '2026-08-15T10:00:00Z',
      },
    })

    const result = await rollbackLessonRunArchive(tx, path, 'job-2025-1')
    expect(result).toEqual({ changed: true, restoredStatus: 'ABORTED' })
    expect(docs.get(path)!.status).toBe('ABORTED')
  })

  it('is idempotent on rollback retry (if already restored, no-op)', async () => {
    const path = 'lessonRuns/run-already-restored'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-already-restored',
        orgId: 'org-1',
        status: 'COMPLETED',
      },
    })

    const result = await rollbackLessonRunArchive(tx, path, 'job-2025-1')
    expect(result).toEqual({ changed: false, reason: 'NOT_ARCHIVED' })
    expect(docs.get(path)!.status).toBe('COMPLETED')
  })

  it('does not rollback a run archived by a different job', async () => {
    const path = 'lessonRuns/run-different-job'
    const { tx, docs } = makeTxFake({
      [path]: {
        id: 'run-different-job',
        orgId: 'org-1',
        status: 'ARCHIVED',
        archiveJobId: 'other-job',
        archivedFromStatus: 'COMPLETED',
      },
    })

    const result = await rollbackLessonRunArchive(tx, path, 'job-2025-1')
    expect(result).toEqual({ changed: false, reason: 'JOB_MISMATCH' })
    expect(docs.get(path)!.status).toBe('ARCHIVED')
  })

  it('fails safely if archivedFromStatus is invalid (not COMPLETED or ABORTED)', async () => {
    const path = 'lessonRuns/run-corrupt'
    const { tx } = makeTxFake({
      [path]: {
        id: 'run-corrupt',
        orgId: 'org-1',
        status: 'ARCHIVED',
        archiveJobId: 'job-2025-1',
        archivedFromStatus: 'RUNNING', // Invalid!
      },
    })

    await expect(rollbackLessonRunArchive(tx, path, 'job-2025-1')).rejects.toThrow('Invalid archivedFromStatus')
  })
})
