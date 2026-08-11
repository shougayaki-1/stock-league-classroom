import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { getParentOrgQuotaUsageCallable, getSchoolEffectiveQuotaCallable, setSchoolQuotaAllocationCallable } from './parentOrgQuotaOnCall'
import { requireActiveOrgMember } from './authorization'

vi.mock('./authorization', () => ({ requireActiveOrgMember: vi.fn() }))

type DocumentData = Record<string, unknown>
type QueryFilter = { field: string; operator: '==' | 'in'; value: unknown }
type FirestoreRef = { path: string; id?: string; filters?: QueryFilter[]; where?: (field: string, operator: '==' | 'in', value: unknown) => FirestoreRef }

const documents = new Map<string, DocumentData>()
const transactionOperations: string[][] = []
const doc = (path: string) => ({ path, id: path.split('/').at(-1) as string })
const collection = (path: string, filters: QueryFilter[] = []): FirestoreRef => ({
  path,
  filters,
  where: (field, operator, value) => collection(path, [...filters, { field, operator, value }]),
})
const snapshotFor = (path: string) => {
  const data = documents.get(path)
  return { exists: Boolean(data), data: () => data, get: (field: string) => data?.[field] }
}
const querySnapshotFor = (ref: FirestoreRef) => {
  const docs = [...documents.entries()]
    .filter(([key]) => key.startsWith(`${ref.path}/`) && key.slice(ref.path.length + 1).split('/').length === 1)
    .filter(([, data]) => (ref.filters ?? []).every(({ field, operator, value }) => operator === '==' ? data[field] === value : Array.isArray(value) && value.includes(data[field])))
    .map(([key, data]) => ({ id: key.split('/').at(-1) as string, data: () => data, get: (field: string) => data[field] }))
  return { docs, size: docs.length }
}
const getMock = vi.fn(async (ref: FirestoreRef) => ref.path.split('/').length % 2 === 0 ? snapshotFor(ref.path) : querySnapshotFor(ref))
const setMock = vi.fn((ref: { path: string }, data: DocumentData) => { documents.set(ref.path, data) })

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  getFirestore: () => ({
    doc,
    collection,
    runTransaction: async (operation: (transaction: { get: typeof getMock; set: typeof setMock; update: typeof setMock }) => Promise<unknown>) => {
      let written = false
      const operations: string[] = []
      transactionOperations.push(operations)
      return operation({
        get: vi.fn(async (ref: FirestoreRef) => {
          if (written) throw new Error('Firestore transactions require all reads before writes')
          operations.push(`get:${ref.path}`)
          return getMock(ref)
        }) as typeof getMock,
        set: vi.fn((ref: { path: string }, data: DocumentData) => {
          written = true
          operations.push(`set:${ref.path}`)
          return setMock(ref, data)
        }) as typeof setMock,
        update: vi.fn((ref: { path: string }, data: DocumentData) => {
          written = true
          operations.push(`update:${ref.path}`)
          return setMock(ref, data)
        }) as typeof setMock,
      })
    },
  }),
}))

const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']

const seedParent = () => {
  documents.set('organizations/parent-1', { type: 'parentOrg', planId: 'PARENT_ORG' })
  documents.set('planDefinitions/PARENT_ORG', { limits: { concurrentLessonsAndMarkets: 4, teacherSeats: 3 } })
  documents.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-1' })
  documents.set('organizations/parent-1/schoolAllocations/school-1', { guaranteedConcurrentLessonsAndMarkets: 1, guaranteedTeacherSeats: 1 })
}

describe('parent organization quota Callables', () => {
  beforeEach(() => { vi.clearAllMocks(); documents.clear(); transactionOperations.length = 0; seedParent() })

  it('allows only a parent owner or admin to change a child-school allocation', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1', guaranteedConcurrentLessonsAndMarkets: 2, guaranteedTeacherSeats: 1 } } as unknown as CallableRequest
    await expect(setSchoolQuotaAllocationCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })

    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    await expect(setSchoolQuotaAllocationCallable.run(request)).resolves.toEqual({ schoolOrgId: 'school-1', guaranteedConcurrentLessonsAndMarkets: 2, guaranteedTeacherSeats: 1 })
  })

  it('rejects a guarantee update that exceeds the parent limit or leaves too little shared capacity for reservations', async () => {
    documents.set('organizations/parent-1/schoolAllocations/school-2', { guaranteedConcurrentLessonsAndMarkets: 3, guaranteedTeacherSeats: 1 })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    await expect(setSchoolQuotaAllocationCallable.run({ auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1', guaranteedConcurrentLessonsAndMarkets: 2, guaranteedTeacherSeats: 1 } } as unknown as CallableRequest)).rejects.toMatchObject({ code: 'failed-precondition', message: '最低保証の合計が上位組織の上限を超えています' })

    documents.set('organizations/parent-1/schoolAllocations/school-2', { guaranteedConcurrentLessonsAndMarkets: 2, guaranteedTeacherSeats: 1 })
    documents.set('organizations/parent-1/quotaReservations/concurrentLessonsAndMarkets:school-2:run-1', { resourceKey: 'concurrentLessonsAndMarkets', schoolOrgId: 'school-2', targetId: 'run-1' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    await expect(setSchoolQuotaAllocationCallable.run({ auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1', guaranteedConcurrentLessonsAndMarkets: 2, guaranteedTeacherSeats: 1 } } as unknown as CallableRequest)).rejects.toMatchObject({ code: 'failed-precondition', message: '既存予約を維持できません' })
  })

  it('rejects an allocation update for a school outside the parent organization', async () => {
    documents.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-2' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })

    await expect(setSchoolQuotaAllocationCallable.run({ auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1', guaranteedConcurrentLessonsAndMarkets: 1, guaranteedTeacherSeats: 1 } } as unknown as CallableRequest)).rejects.toMatchObject({
      code: 'failed-precondition', message: '対象の学校はこの上位組織の直下ではありません',
    })
    expect(setMock).not.toHaveBeenCalled()
  })

  it('returns only aggregate quota DTOs to active members', async () => {
    documents.set('organizations/parent-1/quotaReservations/teacherSeats:school-1:teacher-2', { resourceKey: 'teacherSeats', schoolOrgId: 'school-1', targetId: 'teacher-2', email: 'private@example.com' })
    documents.set('lessonRuns/run-1', { orgId: 'school-1', status: 'RUNNING', participant: { name: '生徒A' }, secret: 'lesson-content' })
    documents.set('organizations/school-1/members/teacher-2', { role: 'teacher', status: 'active', email: 'private@example.com' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(getParentOrgQuotaUsageCallable.run({ auth: teacher, data: { parentOrgId: 'parent-1' } } as unknown as CallableRequest)).resolves.toEqual({
      parentOrgId: 'parent-1',
      concurrentLessonsAndMarkets: { limit: 4, guaranteed: 1, sharedAvailable: 3, reserved: 0 },
      teacherSeats: { limit: 3, guaranteed: 1, sharedAvailable: 1, reserved: 1 },
      schools: [{ schoolOrgId: 'school-1', concurrentLessonsAndMarkets: { guaranteed: 1, usage: 1, reserved: 0 }, teacherSeats: { guaranteed: 1, usage: 1, reserved: 1 } }],
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(getSchoolEffectiveQuotaCallable.run({ auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest)).resolves.toEqual({
      schoolOrgId: 'school-1', parentOrgId: 'parent-1',
      concurrentLessonsAndMarkets: { guaranteed: 1, usage: 1, sharedReserved: 0, effectiveAvailable: 4 },
      teacherSeats: { guaranteed: 1, usage: 1, sharedReserved: 1, effectiveAvailable: 3 },
    })
  })

  it('includes and initializes a linked school whose allocation document is missing', async () => {
    documents.delete('organizations/parent-1/schoolAllocations/school-1')
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })

    await expect(getParentOrgQuotaUsageCallable.run({ auth: teacher, data: { parentOrgId: 'parent-1' } } as unknown as CallableRequest)).resolves.toEqual({
      parentOrgId: 'parent-1',
      concurrentLessonsAndMarkets: { limit: 4, guaranteed: 0, sharedAvailable: 4, reserved: 0 },
      teacherSeats: { limit: 3, guaranteed: 0, sharedAvailable: 3, reserved: 0 },
      schools: [{ schoolOrgId: 'school-1', concurrentLessonsAndMarkets: { guaranteed: 0, usage: 0, reserved: 0 }, teacherSeats: { guaranteed: 0, usage: 0, reserved: 0 } }],
    })
    expect(documents.get('organizations/parent-1/schoolAllocations/school-1')).toMatchObject({
      guaranteedConcurrentLessonsAndMarkets: 0,
      guaranteedTeacherSeats: 0,
    })
    const operations = transactionOperations[0]
    expect(operations.slice(0, operations.findIndex((operation) => operation.startsWith('set:'))).every((operation) => operation.startsWith('get:'))).toBe(true)
    expect(operations.at(-1)).toBe('set:organizations/parent-1/schoolAllocations/school-1')
  })

  it('initializes a missing allocation before returning the linked school effective quota', async () => {
    documents.delete('organizations/parent-1/schoolAllocations/school-1')
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })

    await expect(getSchoolEffectiveQuotaCallable.run({ auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest)).resolves.toEqual({
      schoolOrgId: 'school-1', parentOrgId: 'parent-1',
      concurrentLessonsAndMarkets: { guaranteed: 0, usage: 0, sharedReserved: 0, effectiveAvailable: 4 },
      teacherSeats: { guaranteed: 0, usage: 0, sharedReserved: 0, effectiveAvailable: 3 },
    })
    expect(documents.has('organizations/parent-1/schoolAllocations/school-1')).toBe(true)
  })
})
