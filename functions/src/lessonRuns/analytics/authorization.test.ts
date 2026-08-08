import { describe, expect, it } from 'vitest'
import { requireAnalyticsAccess, type AnalyticsAccessDeps } from './authorization'

interface StoredRun {
  orgId: string
  teacherRoles: Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'>
}

interface StoredMember {
  role: 'owner' | 'admin' | 'teacher'
  status: string
}

const makeDeps = (runs: Record<string, StoredRun>, members: Record<string, StoredMember>): AnalyticsAccessDeps => ({
  getRun: async (lessonRunId) => runs[lessonRunId],
  getOrgMembership: async (orgId, uid) => members[`${orgId}/${uid}`],
})

const RUN: Record<string, StoredRun> = {
  'run-1': { orgId: 'org-a', teacherRoles: { primary: 'PRIMARY', assistant: 'ASSISTANT', viewer: 'VIEWER' } },
}

describe('requireAnalyticsAccess (Step 2: 個票アクセス境界)', () => {
  it('grants INDIVIDUAL access to the PRIMARY teacher of the assigned run, same org', async () => {
    const deps = makeDeps(RUN, { 'org-a/primary': { role: 'teacher', status: 'active' } })
    await expect(requireAnalyticsAccess(deps, 'run-1', 'primary', 'INDIVIDUAL')).resolves.toEqual({ orgId: 'org-a' })
  })

  it('grants INDIVIDUAL access to an ASSISTANT teacher assigned to the run, same org', async () => {
    const deps = makeDeps(RUN, { 'org-a/assistant': { role: 'teacher', status: 'active' } })
    await expect(requireAnalyticsAccess(deps, 'run-1', 'assistant', 'INDIVIDUAL')).resolves.toEqual({ orgId: 'org-a' })
  })

  it('grants AGGREGATE access to a VIEWER role, but denies INDIVIDUAL access to the same VIEWER', async () => {
    const deps = makeDeps(RUN, { 'org-a/viewer': { role: 'teacher', status: 'active' } })
    await expect(requireAnalyticsAccess(deps, 'run-1', 'viewer', 'AGGREGATE')).resolves.toEqual({ orgId: 'org-a' })
    await expect(requireAnalyticsAccess(deps, 'run-1', 'viewer', 'INDIVIDUAL')).rejects.toThrow()
  })

  it('denies INDIVIDUAL and AGGREGATE access to an org owner/admin who is not assigned to this specific run (default-deny)', async () => {
    const deps = makeDeps(RUN, { 'org-a/owner-uid': { role: 'owner', status: 'active' }, 'org-a/admin-uid': { role: 'admin', status: 'active' } })
    await expect(requireAnalyticsAccess(deps, 'run-1', 'owner-uid', 'INDIVIDUAL')).rejects.toThrow()
    await expect(requireAnalyticsAccess(deps, 'run-1', 'owner-uid', 'AGGREGATE')).rejects.toThrow()
    await expect(requireAnalyticsAccess(deps, 'run-1', 'admin-uid', 'INDIVIDUAL')).rejects.toThrow()
  })

  it('denies access to a caller from a different organization, even if they hold teacherRoles by coincidence', async () => {
    const deps = makeDeps(RUN, {}) // no membership record at all for org-a
    await expect(requireAnalyticsAccess(deps, 'run-1', 'primary', 'INDIVIDUAL')).rejects.toThrow()
  })

  it('denies access when the org membership exists but is not active', async () => {
    const deps = makeDeps(RUN, { 'org-a/primary': { role: 'teacher', status: 'removed' } })
    await expect(requireAnalyticsAccess(deps, 'run-1', 'primary', 'INDIVIDUAL')).rejects.toThrow()
  })

  it('denies access to a caller with no teacherRoles entry on this run at all', async () => {
    const deps = makeDeps(RUN, { 'org-a/stranger': { role: 'teacher', status: 'active' } })
    await expect(requireAnalyticsAccess(deps, 'run-1', 'stranger', 'AGGREGATE')).rejects.toThrow()
    await expect(requireAnalyticsAccess(deps, 'run-1', 'stranger', 'INDIVIDUAL')).rejects.toThrow()
  })

  it('throws not-found for a lessonRunId that does not exist', async () => {
    const deps = makeDeps(RUN, { 'org-a/primary': { role: 'teacher', status: 'active' } })
    await expect(requireAnalyticsAccess(deps, 'missing-run', 'primary', 'AGGREGATE')).rejects.toThrow()
  })
})
