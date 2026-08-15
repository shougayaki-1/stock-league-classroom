import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { listOrgAuditLog } from './orgAuditLog'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('listOrgAuditLog', () => {
  it('calls listOrgAuditLogCallable with the orgId and returns the entries', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { entries: [{ id: 'log-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }] } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const result = await listOrgAuditLog({} as never, { orgId: 'org-1' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'listOrgAuditLogCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'org-1' })
    expect(result).toEqual({ entries: [{ id: 'log-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }] })
  })
})
