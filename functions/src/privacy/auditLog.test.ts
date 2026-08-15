import { describe, expect, it, vi } from 'vitest'
import { recordAuditLogEntry, recordOrgDeletionAuditLogEntry } from './auditLog'

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } }))

const addMock = vi.fn()
const collectionPathSpy = vi.fn()
const makeDb = () => ({ collection: (path: string) => { collectionPathSpy(path); return { add: addMock } } }) as unknown as FirebaseFirestore.Firestore

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

describe('recordOrgDeletionAuditLogEntry', () => {
  it('writes to the top-level orgDeletionAuditLog collection (NOT under organizations/{orgId}, which is about to be deleted)', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-1' })
    const db = makeDb()
    await recordOrgDeletionAuditLogEntry(db, { orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS' })
    expect(collectionPathSpy).toHaveBeenCalledWith('orgDeletionAuditLog')
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS', occurredAt: 'SERVER_TIMESTAMP' }))
  })
})

describe('recordAuditLogInTransaction', () => {
  it('sets document in transaction on organizations/{orgId}/auditLog with serverTimestamp', async () => {
    const { recordAuditLogInTransaction } = await import('./auditLog')
    const setMock = vi.fn()
    const docRefMock = { id: 'auto-doc-id' }
    const db = {
      collection: (path: string) => {
        collectionPathSpy(path)
        return { doc: () => docRefMock }
      },
    } as unknown as FirebaseFirestore.Firestore
    const tx = { set: setMock } as unknown as FirebaseFirestore.Transaction

    recordAuditLogInTransaction(tx, db, {
      orgId: 'org-1',
      actorUid: 'owner-1',
      action: 'SCHEDULE_ANNUAL_ARCHIVE',
      result: 'SUCCESS',
      reason: '2025年度アーカイブ',
      after: { jobId: 'job-1', academicYear: 2025 },
    })

    expect(collectionPathSpy).toHaveBeenCalledWith('organizations/org-1/auditLog')
    expect(setMock).toHaveBeenCalledWith(docRefMock, {
      orgId: 'org-1',
      actorUid: 'owner-1',
      action: 'SCHEDULE_ANNUAL_ARCHIVE',
      result: 'SUCCESS',
      occurredAt: 'SERVER_TIMESTAMP',
      reason: '2025年度アーカイブ',
      after: { jobId: 'job-1', academicYear: 2025 },
    })
  })
})


