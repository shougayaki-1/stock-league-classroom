import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestoreState = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  transactions: [] as string[][],
}))

vi.mock('firebase-admin/firestore', () => {
  type Filter = { field: string; value: unknown }
  type Ref = { kind: 'doc' | 'query'; path: string; filters?: Filter[]; where?: (field: string, operator: '==', value: unknown) => Ref }
  const doc = (path: string): Ref => ({ kind: 'doc', path })
  const collection = (path: string, filters: Filter[] = []): Ref => ({
    kind: 'query',
    path,
    filters,
    where: (field, _operator, value) => collection(path, [...filters, { field, value }]),
  })
  const snapshot = (path: string) => {
    const data = firestoreState.documents.get(path)
    return { exists: Boolean(data), get: (field: string) => data?.[field] }
  }
  const querySnapshot = (ref: Ref) => {
    const docs = [...firestoreState.documents.entries()]
      .filter(([path]) => path.startsWith(`${ref.path}/`) && path.slice(ref.path.length + 1).split('/').length === 1)
      .filter(([, data]) => (ref.filters ?? []).every(({ field, value }) => data[field] === value))
    return { size: docs.length }
  }
  return {
    FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
    getFirestore: () => ({
      doc,
      collection,
      runTransaction: async (operation: (transaction: {
        get: (ref: Ref) => Promise<unknown>
        set: (ref: Ref, data: Record<string, unknown>) => void
        update: (ref: Ref, data: Record<string, unknown>) => void
        delete: (ref: Ref) => void
      }) => Promise<unknown>) => {
        const operations: string[] = []
        firestoreState.transactions.push(operations)
        let written = false
        return operation({
          get: async (ref) => {
            if (written) throw new Error('Firestore transactions require all reads before writes')
            operations.push(ref.kind === 'doc' ? `get:${ref.path}` : `query:${ref.path}`)
            return ref.kind === 'doc' ? snapshot(ref.path) : querySnapshot(ref)
          },
          set: (ref, data) => {
            written = true
            operations.push(`set:${ref.path}`)
            firestoreState.documents.set(ref.path, { ...data })
          },
          update: (ref, data) => {
            written = true
            operations.push(`update:${ref.path}`)
            firestoreState.documents.set(ref.path, { ...firestoreState.documents.get(ref.path), ...data })
          },
          delete: (ref) => {
            written = true
            operations.push(`delete:${ref.path}`)
            firestoreState.documents.delete(ref.path)
          },
        })
      },
    }),
  }
})

import {
  linkSchoolToParentOrg,
  linkSchoolToParentOrgWithAdminSdk,
  listChildSchools,
  unlinkSchoolFromParentOrg,
  unlinkSchoolFromParentOrgWithAdminSdk,
} from './schoolHierarchy'

describe('school hierarchy', () => {
  beforeEach(() => {
    firestoreState.documents.clear()
    firestoreState.transactions.length = 0
  })

  it('rejects a non-parent organization, non-school target, and already-linked school', async () => {
    const getNonParent = async (orgId: string) => orgId === 'p'
      ? { type: 'school', parentOrgId: null }
      : { type: 'school', parentOrgId: null }
    await expect(linkSchoolToParentOrg({ getOrg: getNonParent, setParentOrgId: vi.fn(), createZeroAllocation: vi.fn() }, { parentOrgId: 'p', schoolOrgId: 's' }))
      .rejects.toThrow('対象は上位組織ではありません')

    const getNonSchool = async (orgId: string) => orgId === 'p'
      ? { type: 'parentOrg', parentOrgId: null }
      : { type: 'personal', parentOrgId: null }
    await expect(linkSchoolToParentOrg({ getOrg: getNonSchool, setParentOrgId: vi.fn(), createZeroAllocation: vi.fn() }, { parentOrgId: 'p', schoolOrgId: 's' }))
      .rejects.toThrow('対象は学校組織ではありません')

    const getLinkedSchool = async (orgId: string) => orgId === 'p'
      ? { type: 'parentOrg', parentOrgId: null }
      : { type: 'school', parentOrgId: 'other' }
    await expect(linkSchoolToParentOrg({ getOrg: getLinkedSchool, setParentOrgId: vi.fn(), createZeroAllocation: vi.fn() }, { parentOrgId: 'p', schoolOrgId: 's' }))
      .rejects.toThrow('この学校は既に別の上位組織に所属しています')
  })

  it('links a school and creates its zero-guarantee allocation', async () => {
    const setParentOrgId = vi.fn()
    const createZeroAllocation = vi.fn()
    const getOrg = async (orgId: string) => orgId === 'p'
      ? { type: 'parentOrg', parentOrgId: null }
      : { type: 'school', parentOrgId: null }
    await linkSchoolToParentOrg({ getOrg, setParentOrgId, createZeroAllocation }, { parentOrgId: 'p', schoolOrgId: 's' })
    expect(setParentOrgId).toHaveBeenCalledWith('s', 'p')
    expect(createZeroAllocation).toHaveBeenCalledWith('p', 's')
  })

  it('wires link as parent and school reads followed by its writes', async () => {
    firestoreState.documents.set('organizations/parent-1', { type: 'parentOrg' })
    firestoreState.documents.set('organizations/school-1', { type: 'school', parentOrgId: null })

    await linkSchoolToParentOrgWithAdminSdk({ parentOrgId: 'parent-1', schoolOrgId: 'school-1' })

    expect(firestoreState.transactions[0]).toEqual([
      'get:organizations/parent-1',
      'get:organizations/school-1',
      'update:organizations/school-1',
      'set:organizations/parent-1/schoolAllocations/school-1',
    ])
    expect(firestoreState.documents.get('organizations/parent-1/schoolAllocations/school-1')).toMatchObject({
      guaranteedConcurrentLessonsAndMarkets: 0,
      guaranteedTeacherSeats: 0,
    })
  })

  it('rejects a normal school as the requested parent before writing', async () => {
    firestoreState.documents.set('organizations/not-parent', { type: 'school', parentOrgId: null })
    firestoreState.documents.set('organizations/school-1', { type: 'school', parentOrgId: null })

    await expect(linkSchoolToParentOrgWithAdminSdk({ parentOrgId: 'not-parent', schoolOrgId: 'school-1' }))
      .rejects.toThrow('対象は上位組織ではありません')

    expect(firestoreState.transactions[0]).toEqual([
      'get:organizations/not-parent',
      'get:organizations/school-1',
    ])
    expect(firestoreState.documents.get('organizations/school-1')?.parentOrgId).toBeNull()
  })

  it('unlinks a school only when it still belongs to the authorized parent and has no reservations', async () => {
    const clearParentOrgId = vi.fn()
    const deleteAllocation = vi.fn()
    await unlinkSchoolFromParentOrg({
      getOrg: async () => ({ parentOrgId: 'p' }),
      getReservationCount: async () => 0,
      clearParentOrgId,
      deleteAllocation,
    }, { schoolOrgId: 's', expectedParentOrgId: 'p' })
    expect(clearParentOrgId).toHaveBeenCalledWith('s')
    expect(deleteAllocation).toHaveBeenCalledWith('p', 's')

    await expect(unlinkSchoolFromParentOrg({
      getOrg: async () => ({ parentOrgId: 'p' }),
      getReservationCount: async () => 1,
      clearParentOrgId: vi.fn(),
      deleteAllocation: vi.fn(),
    }, { schoolOrgId: 's', expectedParentOrgId: 'p' })).rejects.toThrow('共有枠の予約が残っているため学校を解除できません')
  })

  it('rejects when the school moved to another parent after authorization', async () => {
    firestoreState.documents.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-b' })
    firestoreState.documents.set('organizations/parent-b/schoolAllocations/school-1', { guaranteedTeacherSeats: 2 })

    await expect(unlinkSchoolFromParentOrgWithAdminSdk({ schoolOrgId: 'school-1', expectedParentOrgId: 'parent-a' }))
      .rejects.toThrow('学校の所属先が変更されたため解除できません')

    expect(firestoreState.transactions[0]).toEqual(['get:organizations/school-1'])
    expect(firestoreState.documents.get('organizations/school-1')?.parentOrgId).toBe('parent-b')
    expect(firestoreState.documents.has('organizations/parent-b/schoolAllocations/school-1')).toBe(true)
  })

  it('checks reservations before any unlink write', async () => {
    firestoreState.documents.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-a' })
    firestoreState.documents.set('organizations/parent-a/schoolAllocations/school-1', { guaranteedTeacherSeats: 1 })
    firestoreState.documents.set('organizations/parent-a/quotaReservations/teacherSeats:school-1:t-1', {
      schoolOrgId: 'school-1', resourceKey: 'teacherSeats', targetId: 't-1',
    })

    await expect(unlinkSchoolFromParentOrgWithAdminSdk({ schoolOrgId: 'school-1', expectedParentOrgId: 'parent-a' }))
      .rejects.toThrow('共有枠の予約が残っているため学校を解除できません')

    expect(firestoreState.transactions[0]).toEqual([
      'get:organizations/school-1',
      'query:organizations/parent-a/quotaReservations',
    ])
    expect(firestoreState.documents.get('organizations/school-1')?.parentOrgId).toBe('parent-a')
    expect(firestoreState.documents.has('organizations/parent-a/schoolAllocations/school-1')).toBe(true)
  })

  it('rejects unlinked schools and lists children', async () => {
    await expect(unlinkSchoolFromParentOrg({
      getOrg: async () => ({ parentOrgId: null }),
      getReservationCount: async () => 0,
      clearParentOrgId: vi.fn(),
      deleteAllocation: vi.fn(),
    }, { schoolOrgId: 's', expectedParentOrgId: 'p' })).rejects.toThrow('この学校はどの上位組織にも所属していません')
    const queryChildSchools = vi.fn().mockResolvedValue([])
    await listChildSchools({ queryChildSchools }, { parentOrgId: 'p' })
    expect(queryChildSchools).toHaveBeenCalledWith('p')
  })
})
