import { describe, expect, it, vi } from 'vitest'
import {
  previewAnnualArchive,
  scheduleAnnualArchive,
  cancelAnnualArchive,
  listAnnualArchiveJobs,
} from './annualArchive'
import type { Functions } from 'firebase/functions'

const callableSpy = vi.fn()
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    callableSpy(name, data)
    if (name === 'previewAnnualArchiveCallable') {
      return { data: { academicYear: 2025, periodStart: '2025-04-01T00:00:00+09:00', periodEnd: '2026-04-01T00:00:00+09:00', eligibleCount: 3, missingEndedAtCount: 1 } }
    }
    if (name === 'scheduleAnnualArchiveCallable') {
      return { data: { job: { id: 'job-1', status: 'SCHEDULED' }, deduplicated: false } }
    }
    if (name === 'cancelAnnualArchiveCallable') {
      return { data: { job: { id: 'job-1', status: 'CANCELLING' }, deduplicated: false } }
    }
    if (name === 'listAnnualArchiveJobsCallable') {
      return { data: { jobs: [{ id: 'job-1', status: 'SCHEDULED' }] } }
    }
    return { data: {} }
  },
}))

describe('annualArchive client', () => {
  const functions = {} as Functions

  it('calls previewAnnualArchiveCallable with arguments', async () => {
    const res = await previewAnnualArchive(functions, { orgId: 'org-1', academicYear: 2025 })
    expect(callableSpy).toHaveBeenCalledWith('previewAnnualArchiveCallable', { orgId: 'org-1', academicYear: 2025 })
    expect(res.eligibleCount).toBe(3)
  })

  it('calls scheduleAnnualArchiveCallable with arguments', async () => {
    const res = await scheduleAnnualArchive(functions, {
      orgId: 'org-1',
      academicYear: 2025,
      scheduledFor: '2026-08-20T00:00:00Z',
      reason: '年度アーカイブ',
      idempotencyKey: 'key-1',
    })
    expect(callableSpy).toHaveBeenCalledWith('scheduleAnnualArchiveCallable', expect.objectContaining({ orgId: 'org-1', academicYear: 2025 }))
    expect(res.job.status).toBe('SCHEDULED')
  })

  it('calls cancelAnnualArchiveCallable with arguments', async () => {
    const res = await cancelAnnualArchive(functions, {
      orgId: 'org-1',
      jobId: 'job-1',
      reason: '取消',
      idempotencyKey: 'key-2',
    })
    expect(callableSpy).toHaveBeenCalledWith('cancelAnnualArchiveCallable', expect.objectContaining({ jobId: 'job-1' }))
    expect(res.job.status).toBe('CANCELLING')
  })

  it('calls listAnnualArchiveJobsCallable with arguments', async () => {
    const res = await listAnnualArchiveJobs(functions, { orgId: 'org-1' })
    expect(callableSpy).toHaveBeenCalledWith('listAnnualArchiveJobsCallable', { orgId: 'org-1' })
    expect(res.jobs).toHaveLength(1)
  })
})
