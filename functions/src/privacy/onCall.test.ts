import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  exportOrgStudentDataCallable,
  exportPersonalDataCallable,
  isReauthFresh,
  listOrgAuditLogCallable,
  normalizeResourcePath,
  purgeHardDeleteCallable,
  purgePersonalOrganizationCallable,
  purgeSchoolOrgCallable,
  requestSoftDeleteCallable,
  restoreSoftDeletedCallable,
  searchOrgStudentDataCallable,
} from './onCall'
import { exportPersonalDataWithAdminSdk } from './exportPersonalData'
import { requireActiveOrgMember } from '../organizations/authorization'
import { exportOrgStudentDataWithAdminSdk } from './exportOrgStudentData'
import { searchOrgStudentDataWithAdminSdk } from './searchOrgStudentData'
import { recordAuditLogEntry, recordOrgDeletionAuditLogEntry } from './auditLog'
import {
  purgeHardDeleteResourceWithAdminSdk,
  purgePersonalOrganizationWithAdminSdk,
  purgeSchoolOrgWithAdminSdk,
  requestSoftDeleteWithAdminSdk,
  restoreSoftDeletedWithAdminSdk,
} from './deletePersonalData'

const orgDocGetMock = vi.fn()
const resourceDocs = new Map<string, { exists: boolean; data?: Record<string, unknown> }>()
const auditLogDocs: Array<{ id: string; data: Record<string, unknown> }> = []

vi.mock('./exportPersonalData', () => ({ exportPersonalDataWithAdminSdk: vi.fn() }))
vi.mock('./exportOrgStudentData', () => ({ exportOrgStudentDataWithAdminSdk: vi.fn() }))
vi.mock('./searchOrgStudentData', () => ({ searchOrgStudentDataWithAdminSdk: vi.fn() }))
vi.mock('./auditLog', () => ({
  recordAuditLogEntry: vi.fn(),
  recordOrgDeletionAuditLogEntry: vi.fn(),
}))
vi.mock('./deletePersonalData', () => ({
  requestSoftDeleteWithAdminSdk: vi.fn(),
  restoreSoftDeletedWithAdminSdk: vi.fn(),
  purgeHardDeleteResourceWithAdminSdk: vi.fn(),
  purgePersonalOrganizationWithAdminSdk: vi.fn(),
  purgeSchoolOrgWithAdminSdk: vi.fn(),
}))
vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      get: async () => {
        if (path.startsWith('organizations/')) return orgDocGetMock()
        const entry = resourceDocs.get(path)
        return {
          exists: entry?.exists ?? false,
          get: (field: string) => entry?.data?.[field],
        }
      },
    }),
    collection: (path: string) => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            docs: path.includes('/auditLog')
              ? auditLogDocs.map((entry) => ({ id: entry.id, data: () => entry.data }))
              : [],
          }),
        }),
      }),
      limit: () => ({
        get: async () => ({
          empty: true,
          docs: [],
        }),
      }),
    }),
  }),
}))

const NOW_MS = Date.parse('2026-08-07T12:00:00.000Z')
const NOW_SECONDS = NOW_MS / 1000

const makeRequest = (overrides: {
  uid?: string
  authTime?: number
  data?: unknown
  noAuth?: boolean
} = {}): CallableRequest<unknown> => {
  if (overrides.noAuth) {
    return { auth: undefined, data: overrides.data ?? {}, rawRequest: {} } as unknown as CallableRequest<unknown>
  }
  return {
    auth: {
      uid: overrides.uid ?? 'teacher-a',
      token: {
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
        auth_time: overrides.authTime ?? NOW_SECONDS,
      },
    },
    data: overrides.data ?? {},
    rawRequest: {},
  } as unknown as CallableRequest<unknown>
}

const makeOrgSnap = (exists: boolean, ownerUid?: string) => ({
  exists,
  get: (field: string) => (field === 'ownerUid' ? ownerUid : undefined),
})

describe('isReauthFresh', () => {
  it('accepts an auth_time exactly at the 10 minute boundary', () => {
    expect(isReauthFresh(NOW_SECONDS - 600, NOW_MS)).toBe(true)
  })
  it('rejects an auth_time older than 10 minutes', () => {
    expect(isReauthFresh(NOW_SECONDS - 601, NOW_MS)).toBe(false)
  })
  it('rejects a missing auth_time', () => {
    expect(isReauthFresh(undefined, NOW_MS)).toBe(false)
  })
  it('accepts an auth_time exactly now', () => {
    expect(isReauthFresh(NOW_SECONDS, NOW_MS)).toBe(true)
  })
})

describe('exportPersonalDataCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects an anonymous (unauthenticated) caller, never touching Firestore', async () => {
    await expect(exportPersonalDataCallable.run(makeRequest({ noAuth: true }))).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(orgDocGetMock).not.toHaveBeenCalled()
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a stale auth_time (reauthentication required) before ever reading the organization', async () => {
    const request = makeRequest({ authTime: NOW_SECONDS - 601 })
    await expect(exportPersonalDataCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(orgDocGetMock).not.toHaveBeenCalled()
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds past the reauth check for a fresh auth_time', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue({ uid: 'teacher-a' } as never)
    const request = makeRequest({ authTime: NOW_SECONDS - 599 })
    await expect(exportPersonalDataCallable.run(request)).resolves.toBeDefined()
    expect(exportPersonalDataWithAdminSdk).toHaveBeenCalled()
  })

  it('never reads orgId from request.data, always deriving personal_<uid> server-side', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue({ uid: 'teacher-a' } as never)
    const request = makeRequest({ data: { orgId: 'attacker-supplied-org' } })
    await exportPersonalDataCallable.run(request)
    expect(exportPersonalDataWithAdminSdk).toHaveBeenCalledWith('teacher-a', 'personal_teacher-a')
  })

  it('rejects when the organization document does not exist', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(false))
    await expect(exportPersonalDataCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects another uid (ownerUid mismatch) even though orgId always resolves to their own personal org', async () => {
    // Simulates a tampered/corrupted org record where ownerUid no longer
    // matches the caller — the independent Admin SDK ownership check must
    // catch this even though personalOrgId(uid) always derives "their own" id.
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'someone-else'))
    await expect(exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ownerUid mismatch even when the caller is an active member by some other record', async () => {
    // Ownership (organizations/{orgId}.ownerUid), not membership status, is
    // the actual gate for this Callable. A caller must not be able to bypass
    // the ownership check by pointing to any membership doc showing active.
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'someone-else'))
    await expect(exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('allows self-export even when the caller\'s membership is suspended — the export path never gates on membership status', async () => {
    // This Callable must never call requireActiveOrgMember or otherwise
    // check membership status: ownerUid match alone authorizes self-export,
    // per this task's explicit carve-out for the owner's own privacy right.
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue({
      uid: 'teacher-a',
      membership: { uid: 'teacher-a', role: 'owner', status: 'suspended' },
    } as never)
    const result = await exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))
    expect(result).toMatchObject({ membership: { status: 'suspended' } })
    expect(exportPersonalDataWithAdminSdk).toHaveBeenCalledWith('teacher-a', 'personal_teacher-a')
  })

  it('returns the complete JSON export shape end-to-end for the caller\'s own personal org', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    const fullExport = {
      exportedAt: '2026-08-07T12:00:00.000Z',
      uid: 'teacher-a',
      orgId: 'personal_teacher-a',
      user: { id: 'teacher-a', displayName: 'Teacher A' },
      organization: { id: 'personal_teacher-a', type: 'personal', ownerUid: 'teacher-a' },
      membership: { uid: 'teacher-a', role: 'owner', status: 'active' },
      orgAccessMirror: { role: 'owner', status: 'active', membershipVersion: 1 },
      orgAccessMeta: { membershipVersion: 1, syncState: 'SYNCED' },
      lessonTemplates: [{ id: 't1', orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: {}, versions: [{ id: 'v1', templateId: 't1' }] }],
      lessonRuns: [{ id: 'r1', orgId: 'personal_teacher-a', templateId: 't1', events: [{ id: 'e1', sequence: 0 }], checkpoints: [{ id: 'c1', sequence: 0 }] }],
    }
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue(fullExport as never)

    const result = await exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))

    expect(result).toEqual(fullExport)
  })
})

// ---------------------------------------------------------------------------
// Resource-level Callables
// ---------------------------------------------------------------------------

describe('normalizeResourcePath', () => {
  it('accepts lessonTemplates/{id}', () => {
    expect(normalizeResourcePath('lessonTemplates/t1')).toEqual({ collection: 'lessonTemplates', id: 't1' })
  })
  it('accepts lessonRuns/{id}', () => {
    expect(normalizeResourcePath('lessonRuns/run-1')).toEqual({ collection: 'lessonRuns', id: 'run-1' })
  })
  it('rejects a subcollection path (extra segments)', () => {
    expect(() => normalizeResourcePath('lessonRuns/run-1/events/e1')).toThrow(HttpsError)
  })
  it('rejects a path-traversal attempt targeting another collection', () => {
    expect(() => normalizeResourcePath('lessonTemplates/../organizations/other-org')).toThrow(HttpsError)
  })
  it('rejects an id of ".."', () => {
    expect(() => normalizeResourcePath('lessonRuns/..')).toThrow(HttpsError)
  })
  it('rejects a disallowed collection name', () => {
    expect(() => normalizeResourcePath('organizations/other-org')).toThrow(HttpsError)
  })
  it('rejects a single-segment path', () => {
    expect(() => normalizeResourcePath('lessonRuns')).toThrow(HttpsError)
  })
  it('rejects a non-string path', () => {
    expect(() => normalizeResourcePath(undefined)).toThrow(HttpsError)
  })
})

const makeTeacherRequest = (data: unknown, uid = 'teacher-a'): CallableRequest<unknown> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data,
  rawRequest: {},
} as unknown as CallableRequest<unknown>)

const setResourceDoc = (path: string, exists: boolean, data?: Record<string, unknown>) => {
  resourceDocs.set(path, { exists, data })
}

describe('requestSoftDeleteCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceDocs.clear()
  })

  it('rejects an unauthenticated caller', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<unknown>
    await expect(requestSoftDeleteCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects a non-teacher caller', async () => {
    const request = { auth: { uid: 'x', token: { email_verified: false } }, data: {}, rawRequest: {} } as unknown as CallableRequest<unknown>
    await expect(requestSoftDeleteCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a missing/blank reason before touching Firestore', async () => {
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', reason: '   ' })
    await expect(requestSoftDeleteCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
  })

  it('rejects a path-traversal / malformed path before any Firestore read', async () => {
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1/events/e1', reason: '誤操作' })
    await expect(requestSoftDeleteCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(requestSoftDeleteWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when the target does not belong to the org the caller is an active member of (different org)', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'org-other' })
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', reason: '誤操作' })
    await expect(requestSoftDeleteCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-other', 'teacher-a')
    expect(requestSoftDeleteWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a suspended membership', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', reason: '誤操作' })
    await expect(requestSoftDeleteCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requestSoftDeleteWithAdminSdk).not.toHaveBeenCalled()
  })

  it('marks the resource for soft deletion for an active member', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(requestSoftDeleteWithAdminSdk).mockResolvedValue(undefined)
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', reason: '誤操作' })
    await expect(requestSoftDeleteCallable.run(request)).resolves.toEqual({ path: 'lessonRuns/run-1' })
    expect(requestSoftDeleteWithAdminSdk).toHaveBeenCalledWith({ path: 'lessonRuns/run-1', reason: '誤操作' })
  })
})

describe('restoreSoftDeletedCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceDocs.clear()
  })

  it('rejects a path-traversal / malformed path before any Firestore read', async () => {
    const request = makeTeacherRequest({ path: 'lessonTemplates/../organizations/other-org' })
    await expect(restoreSoftDeletedCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
  })

  it('rejects a suspended membership', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1' })
    await expect(restoreSoftDeletedCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(restoreSoftDeletedWithAdminSdk).not.toHaveBeenCalled()
  })

  it('translates the underlying "Restore window expired" failure into failed-precondition', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(restoreSoftDeletedWithAdminSdk).mockRejectedValue(new Error('Restore window expired'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1' })
    await expect(restoreSoftDeletedCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition', message: 'Restore window expired' })
  })

  it('translates "Document not found" from restoreSoftDeleted into not-found', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(restoreSoftDeletedWithAdminSdk).mockRejectedValue(new Error('Document not found'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1' })
    await expect(restoreSoftDeletedCallable.run(request)).rejects.toMatchObject({ code: 'not-found', message: 'Document not found' })
  })

  it('translates "Document is not pending deletion" from restoreSoftDeleted into failed-precondition', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(restoreSoftDeletedWithAdminSdk).mockRejectedValue(new Error('Document is not pending deletion'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1' })
    await expect(restoreSoftDeletedCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition', message: 'Document is not pending deletion' })
  })

  it('restores for an active member within the window', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(restoreSoftDeletedWithAdminSdk).mockResolvedValue(undefined)
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1' })
    await expect(restoreSoftDeletedCallable.run(request)).resolves.toEqual({ path: 'lessonRuns/run-1' })
  })
})

describe('purgeHardDeleteCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceDocs.clear()
  })

  it('rejects a missing confirm/confirmTargetId/idempotencyKey before touching Firestore', async () => {
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1' })
    await expect(purgeHardDeleteCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
  })

  it('rejects confirm: false even with a valid confirmTargetId and idempotencyKey', async () => {
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', confirm: false, confirmTargetId: 'run-1', idempotencyKey: 'k1' })
    await expect(purgeHardDeleteCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects a path-traversal / malformed path before any Firestore read', async () => {
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1/events/e1', confirm: true, confirmTargetId: 'run-1', idempotencyKey: 'k1' })
    await expect(purgeHardDeleteCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(purgeHardDeleteResourceWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a different org (not an active member of the target\'s own org)', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'org-other' })
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', confirm: true, confirmTargetId: 'run-1', idempotencyKey: 'k1' })
    await expect(purgeHardDeleteCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(purgeHardDeleteResourceWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a suspended membership', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', confirm: true, confirmTargetId: 'run-1', idempotencyKey: 'k1' })
    await expect(purgeHardDeleteCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(purgeHardDeleteResourceWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when confirmTargetId does not match the id in path (re-entry proof of intent)', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', confirm: true, confirmTargetId: 'run-2', idempotencyKey: 'k1' })
    await expect(purgeHardDeleteCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(purgeHardDeleteResourceWithAdminSdk).not.toHaveBeenCalled()
  })

  it('purges for an active member with matching confirm/confirmTargetId/idempotencyKey', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(purgeHardDeleteResourceWithAdminSdk).mockResolvedValue({ operationId: 'op-1', completed: true, alreadyCompleted: false })
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', confirm: true, confirmTargetId: 'run-1', idempotencyKey: 'k1' })
    await expect(purgeHardDeleteCallable.run(request)).resolves.toEqual({ operationId: 'op-1', completed: true, alreadyCompleted: false })
    expect(purgeHardDeleteResourceWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'personal_teacher-a', collection: 'lessonRuns', id: 'run-1', uid: 'teacher-a', idempotencyKey: 'k1',
    })
  })

  it('translates an idempotency key payload mismatch from the deletion saga into failed-precondition', async () => {
    setResourceDoc('lessonRuns/run-1', true, { orgId: 'personal_teacher-a' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(purgeHardDeleteResourceWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    const request = makeTeacherRequest({ path: 'lessonRuns/run-1', confirm: true, confirmTargetId: 'run-1', idempotencyKey: 'k1' })
    await expect(purgeHardDeleteCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })
})

describe('purgePersonalOrganizationCallable', () => {
  const NOW_MS = Date.parse('2026-08-07T12:00:00.000Z')
  const NOW_SECONDS = NOW_MS / 1000

  beforeEach(() => {
    vi.clearAllMocks()
    resourceDocs.clear()
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const makeOrgPurgeRequest = (overrides: { uid?: string; authTime?: number; data?: unknown; noAuth?: boolean } = {}): CallableRequest<unknown> => {
    if (overrides.noAuth) return { auth: undefined, data: overrides.data ?? {}, rawRequest: {} } as unknown as CallableRequest<unknown>
    return {
      auth: { uid: overrides.uid ?? 'teacher-a', token: { auth_time: overrides.authTime ?? NOW_SECONDS } },
      data: overrides.data ?? { confirm: true, confirmUid: overrides.uid ?? 'teacher-a', idempotencyKey: 'org-purge-1' },
      rawRequest: {},
    } as unknown as CallableRequest<unknown>
  }

  it('rejects an unauthenticated caller', async () => {
    await expect(purgePersonalOrganizationCallable.run(makeOrgPurgeRequest({ noAuth: true }))).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects a stale auth_time before ever reading the organization', async () => {
    const request = makeOrgPurgeRequest({ authTime: NOW_SECONDS - 601 })
    await expect(purgePersonalOrganizationCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(orgDocGetMock).not.toHaveBeenCalled()
  })

  it('rejects a missing confirm/confirmUid/idempotencyKey', async () => {
    const request = makeOrgPurgeRequest({ data: { confirm: true } })
    await expect(purgePersonalOrganizationCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(orgDocGetMock).not.toHaveBeenCalled()
  })

  it('rejects confirmUid not matching the caller\'s own uid (re-entry proof of intent)', async () => {
    const request = makeOrgPurgeRequest({ data: { confirm: true, confirmUid: 'someone-else', idempotencyKey: 'k1' } })
    await expect(purgePersonalOrganizationCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(purgePersonalOrganizationWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when the caller does not own their own personal org record (ownerUid mismatch)', async () => {
    orgDocGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'ownerUid' ? 'someone-else' : undefined) })
    const request = makeOrgPurgeRequest()
    await expect(purgePersonalOrganizationCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(purgePersonalOrganizationWithAdminSdk).not.toHaveBeenCalled()
  })

  it('never accepts orgId from the client — always personalOrgId(uid) — and never calls requireActiveOrgMember (no membership gate)', async () => {
    orgDocGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'ownerUid' ? 'teacher-a' : undefined) })
    vi.mocked(purgePersonalOrganizationWithAdminSdk).mockResolvedValue({ operationId: 'op-1', completed: true, alreadyCompleted: false })
    const request = makeOrgPurgeRequest({ data: { confirm: true, confirmUid: 'teacher-a', idempotencyKey: 'k1', orgId: 'attacker-supplied-org' } })
    await purgePersonalOrganizationCallable.run(request)
    expect(purgePersonalOrganizationWithAdminSdk).toHaveBeenCalledWith({ uid: 'teacher-a', orgId: 'personal_teacher-a', idempotencyKey: 'k1' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
  })

  it('allows a suspended member to purge their own personal org — ownership, not membership status, gates this Callable', async () => {
    // Mirrors exportPersonalDataCallable's identical carve-out: a suspended
    // person must still be able to exercise their own formal deletion right.
    orgDocGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'ownerUid' ? 'teacher-a' : undefined) })
    vi.mocked(purgePersonalOrganizationWithAdminSdk).mockResolvedValue({ operationId: 'op-1', completed: true, alreadyCompleted: false })
    const request = makeOrgPurgeRequest()
    await expect(purgePersonalOrganizationCallable.run(request)).resolves.toEqual({ operationId: 'op-1', completed: true, alreadyCompleted: false })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
  })

  it('translates an idempotency key payload mismatch from the deletion saga into failed-precondition', async () => {
    orgDocGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'ownerUid' ? 'teacher-a' : undefined) })
    vi.mocked(purgePersonalOrganizationWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    const request = makeOrgPurgeRequest()
    await expect(purgePersonalOrganizationCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })
})

describe('exportOrgStudentDataCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })
  afterEach(() => { vi.useRealTimers() })

  it('rejects an anonymous caller, never touching Firestore', async () => {
    await expect(exportOrgStudentDataCallable.run(makeRequest({ noAuth: true }))).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(exportOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a stale auth_time before checking org membership', async () => {
    const request = makeRequest({ authTime: NOW_SECONDS - 601, data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
  })

  it('rejects a non-owner (admin/teacher) member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    const request = makeRequest({ data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(exportOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not an active org member', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    const request = makeRequest({ data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).rejects.toThrow('permission-denied')
  })

  it('returns the export for an owner with a fresh reauth', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(exportOrgStudentDataWithAdminSdk).mockResolvedValueOnce({ exportedAt: '2026-08-15T00:00:00.000Z', orgId: 'school-1', lessonRuns: [] })
    const request = makeRequest({ data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).resolves.toMatchObject({ orgId: 'school-1' })
    expect(exportOrgStudentDataWithAdminSdk).toHaveBeenCalledWith('school-1')
  })

  it('records a SUCCESS audit log entry after a successful export', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(exportOrgStudentDataWithAdminSdk).mockResolvedValueOnce({ exportedAt: '2026-08-15T00:00:00.000Z', orgId: 'org-1', lessonRuns: [] })
    await exportOrgStudentDataCallable.run(makeRequest({ uid: 'owner-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))
    expect(recordAuditLogEntry).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS' })
  })

  it('records a FAILURE audit log entry when the caller is not an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    await expect(exportOrgStudentDataCallable.run(makeRequest({ uid: 'admin-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(recordAuditLogEntry).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', actorUid: 'admin-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'FAILURE' })
  })
})

describe('listOrgAuditLogCallable', () => {
  beforeEach(() => { auditLogDocs.length = 0 })

  it('rejects a caller who is not an owner or admin of the org', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(listOrgAuditLogCallable.run(makeRequest({ uid: 'teacher-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('returns recent entries for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    auditLogDocs.push({
      id: 'log-1',
      data: { orgId: 'org-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: { toDate: () => new Date('2026-08-15T00:00:00.000Z') } },
    })
    const response = await listOrgAuditLogCallable.run(makeRequest({ uid: 'owner-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))
    expect(response).toEqual({ entries: [{ id: 'log-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }] })
  })
})

describe('purgeSchoolOrgCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })
  afterEach(() => { vi.useRealTimers() })

  const validRequest = (overrides: Record<string, unknown> = {}) => makeRequest({
    uid: 'owner-a', authTime: NOW_SECONDS,
    data: { orgId: 'school-1', confirm: true, confirmOrgId: 'school-1', idempotencyKey: 'key-1', ...overrides },
  })

  it('rejects when confirmOrgId does not match orgId', async () => {
    await expect(purgeSchoolOrgCallable.run(validRequest({ confirmOrgId: 'wrong-id' }))).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects a stale sign-in', async () => {
    await expect(purgeSchoolOrgCallable.run(makeRequest({ uid: 'owner-a', authTime: NOW_SECONDS - 3600, data: { orgId: 'school-1', confirm: true, confirmOrgId: 'school-1', idempotencyKey: 'key-1' } })))
      .rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('rejects a non-owner before ever reading the org document (no type/hierarchy info leaks to a non-member)', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    await expect(purgeSchoolOrgCallable.run(validRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(orgDocGetMock).not.toHaveBeenCalled()
  })

  it('rejects a personal org', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    orgDocGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'type' ? 'personal' : undefined) })
    await expect(purgeSchoolOrgCallable.run(validRequest())).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects an org still linked to a parent org', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    orgDocGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'type' ? 'school' : field === 'parentOrgId' ? 'parent-1' : undefined) })
    await expect(purgeSchoolOrgCallable.run(validRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('purges the org and records a SUCCESS deletion audit log entry for a valid owner request', async () => {
    orgDocGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'type' ? 'school' : undefined) })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(purgeSchoolOrgWithAdminSdk).mockResolvedValueOnce({ operationId: 'op-1', completed: true, alreadyCompleted: false } as never)
    await purgeSchoolOrgCallable.run(validRequest())
    expect(recordOrgDeletionAuditLogEntry).toHaveBeenCalledWith(expect.anything(), { orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS' })
  })
})

describe('searchOrgStudentDataCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const validData = {
    orgId: 'school-1',
    field: 'displayName',
    query: '山田 太郎',
    reason: '学籍照会のため',
  }

  it('rejects an anonymous caller, never checking membership or searching', async () => {
    await expect(searchOrgStudentDataCallable.run(makeRequest({ noAuth: true, data: validData }))).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(searchOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a non-teacher caller', async () => {
    const request = {
      auth: { uid: 'teacher-a', token: { email_verified: false, firebase: { sign_in_provider: 'google.com' } } },
      data: validData,
      rawRequest: {},
    } as unknown as CallableRequest<unknown>
    await expect(searchOrgStudentDataCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(searchOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects invalid/missing arguments (orgId, field, query, reason)', async () => {
    // Missing orgId
    await expect(searchOrgStudentDataCallable.run(makeRequest({ data: { ...validData, orgId: undefined } }))).rejects.toMatchObject({ code: 'invalid-argument' })
    // Invalid field
    await expect(searchOrgStudentDataCallable.run(makeRequest({ data: { ...validData, field: 'authUid' } }))).rejects.toMatchObject({ code: 'invalid-argument' })
    // Non-string query
    await expect(searchOrgStudentDataCallable.run(makeRequest({ data: { ...validData, query: 123 } }))).rejects.toMatchObject({ code: 'invalid-argument' })
    // Empty reason
    await expect(searchOrgStudentDataCallable.run(makeRequest({ data: { ...validData, reason: '   ' } }))).rejects.toMatchObject({ code: 'invalid-argument' })
    // Reason too long (> 500 chars)
    await expect(searchOrgStudentDataCallable.run(makeRequest({ data: { ...validData, reason: 'a'.repeat(501) } }))).rejects.toMatchObject({ code: 'invalid-argument' })

    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(searchOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when requireActiveOrgMember fails', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))
    await expect(searchOrgStudentDataCallable.run(makeRequest({ data: validData }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(searchOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects active teacher role (only owner and admin are allowed)', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(searchOrgStudentDataCallable.run(makeRequest({ data: validData }))).rejects.toMatchObject({
      code: 'permission-denied',
      message: '組織のowner・adminのみ生徒データを検索できます。',
    })
    expect(searchOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('passes actorRole: owner to search service for owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(searchOrgStudentDataWithAdminSdk).mockResolvedValueOnce({
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [{ lessonRunId: 'run-1', participantId: 'p-1', displayName: '山田 太郎' }],
    })

    const result = await searchOrgStudentDataCallable.run(makeRequest({ uid: 'owner-a', data: validData }))

    expect(searchOrgStudentDataWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'school-1',
      actorUid: 'owner-a',
      actorRole: 'owner',
      field: 'displayName',
      query: '山田 太郎',
    })
    expect(result).toMatchObject({ truncated: false, matches: [{ participantId: 'p-1' }] })
  })

  it('passes actorRole: admin to search service for admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    vi.mocked(searchOrgStudentDataWithAdminSdk).mockResolvedValueOnce({
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [],
    })

    await searchOrgStudentDataCallable.run(makeRequest({ uid: 'admin-a', data: validData }))

    expect(searchOrgStudentDataWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'school-1',
      actorUid: 'admin-a',
      actorRole: 'admin',
      field: 'displayName',
      query: '山田 太郎',
    })
  })

  it('verifies requireActiveOrgMember is invoked strictly before search service', async () => {
    const callOrder: string[] = []
    vi.mocked(requireActiveOrgMember).mockImplementation(async () => {
      callOrder.push('requireActiveOrgMember')
      return { role: 'owner', membershipVersion: 1 }
    })
    vi.mocked(searchOrgStudentDataWithAdminSdk).mockImplementation(async () => {
      callOrder.push('searchOrgStudentDataWithAdminSdk')
      return { expiresAt: '2026-08-15T12:10:00.000Z', truncated: false, matches: [] }
    })
    vi.mocked(recordAuditLogEntry).mockImplementation(async () => {
      callOrder.push('recordAuditLogEntry')
    })

    await searchOrgStudentDataCallable.run(makeRequest({ uid: 'owner-a', data: validData }))

    expect(callOrder).toEqual(['requireActiveOrgMember', 'searchOrgStudentDataWithAdminSdk', 'recordAuditLogEntry'])
  })

  it('records audit log without search query, displayName, or externalIdentifier', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(searchOrgStudentDataWithAdminSdk).mockResolvedValueOnce({
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [
        {
          lessonRunId: 'run-1',
          participantId: 'p-1',
          displayName: '山田 太郎',
          externalIdentifier: 'EXT-123',
        },
      ],
    })

    await searchOrgStudentDataCallable.run(makeRequest({ uid: 'owner-a', data: validData }))

    expect(recordAuditLogEntry).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'school-1',
      actorUid: 'owner-a',
      action: 'SEARCH_ORG_STUDENT_DATA',
      result: 'SUCCESS',
      reason: '学籍照会のため',
      after: {
        field: 'displayName',
        matchCount: 1,
        matches: [{ lessonRunId: 'run-1', participantId: 'p-1' }],
      },
    })
    const auditCallArg = vi.mocked(recordAuditLogEntry).mock.calls[0][1] as unknown as Record<string, unknown>
    const serialized = JSON.stringify(auditCallArg)
    expect(serialized).not.toContain('山田 太郎')
    expect(serialized).not.toContain('EXT-123')
  })

  it('does not return search results if audit log recording rejects', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(searchOrgStudentDataWithAdminSdk).mockResolvedValueOnce({
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [{ lessonRunId: 'run-1', participantId: 'p-1' }],
    })
    vi.mocked(recordAuditLogEntry).mockRejectedValueOnce(new Error('Audit log write failed'))

    await expect(searchOrgStudentDataCallable.run(makeRequest({ uid: 'owner-a', data: validData }))).rejects.toThrow('Audit log write failed')
  })

  it('allows execution even with a stale auth_time (no fresh reauth requirement)', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(searchOrgStudentDataWithAdminSdk).mockResolvedValueOnce({
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [],
    })

    // auth_time is 2 hours ago (older than 10 minutes)
    const request = makeRequest({ uid: 'owner-a', authTime: NOW_SECONDS - 7200, data: validData })
    await expect(searchOrgStudentDataCallable.run(request)).resolves.toBeDefined()
  })
})



