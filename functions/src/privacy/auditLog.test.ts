import { describe, expect, it, vi } from 'vitest'
import { recordAuditLogEntry } from './auditLog'

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } }))

const addMock = vi.fn()
const makeDb = () => ({ collection: (_path: string) => ({ add: addMock }) }) as unknown as FirebaseFirestore.Firestore

describe('recordAuditLogEntry', () => {
  it('writes to organizations/{orgId}/auditLog with all provided fields plus a server timestamp', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-1' })
    const db = makeDb()
    await recordAuditLogEntry(db, {
      orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS',
    })
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS',
      occurredAt: 'SERVER_TIMESTAMP',
    }))
  })

  it('omits reason/before/after from the written document when not provided', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-2' })
    const db = makeDb()
    await recordAuditLogEntry(db, { orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'FAILURE' })
    const written = addMock.mock.calls[0][0]
    expect(written).not.toHaveProperty('reason')
    expect(written).not.toHaveProperty('before')
    expect(written).not.toHaveProperty('after')
  })

  it('includes reason/before/after when provided', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-3' })
    const db = makeDb()
    await recordAuditLogEntry(db, {
      orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS',
      reason: '年度末の一括確認', before: { lessonRunCount: 3 }, after: { lessonRunCount: 3 },
    })
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      reason: '年度末の一括確認', before: { lessonRunCount: 3 }, after: { lessonRunCount: 3 },
    }))
  })
})
