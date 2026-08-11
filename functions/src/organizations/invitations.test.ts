import { describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  getFirestore: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
}))

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: firestore.serverTimestamp },
  getFirestore: firestore.getFirestore,
}))

import {
  acceptInvitation,
  createInvitation,
  createInvitationWithAdminSdk,
  listMyInvitations,
  reserveTeacherSeatForInvitation,
} from './invitations'

const makeQuotaFirestore = () => {
  const documents = new Map<string, Record<string, unknown>>()
  const activeTeacherCounts = new Map<string, number>()
  const documentReads: string[] = []
  const collectionReads: string[] = []
  const writes: string[] = []

  return {
    documents,
    activeTeacherCounts,
    documentReads,
    collectionReads,
    writes,
    runTransaction: async (operation: (transaction: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      getCollection: (path: string) => Promise<Array<{ id: string; data: () => Record<string, unknown> }>>
      countActiveTeachers: (orgId: string) => Promise<number>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<{ alreadyActive: boolean }>) => {
      let hasWritten = false
      const assertReadBeforeWrite = () => {
        if (hasWritten) throw new Error('Firestore transactions require all reads before writes')
      }
      return operation({
        get: async (path) => {
          assertReadBeforeWrite()
          documentReads.push(path)
          return { exists: documents.has(path), data: () => documents.get(path) }
        },
        getCollection: async (path) => {
          assertReadBeforeWrite()
          collectionReads.push(path)
          return [...documents.entries()]
            .filter(([documentPath]) => documentPath.startsWith(`${path}/`))
            .filter(([documentPath]) => !documentPath.slice(path.length + 1).includes('/'))
            .map(([documentPath, data]) => ({ id: documentPath.slice(path.length + 1), data: () => data }))
        },
        countActiveTeachers: async (orgId) => {
          assertReadBeforeWrite()
          return activeTeacherCounts.get(orgId) ?? 0
        },
        set: (path, data) => {
          hasWritten = true
          writes.push(path)
          documents.set(path, data)
        },
      })
    },
  }
}

const seedLinkedSchoolTeacherQuota = (
  fake: ReturnType<typeof makeQuotaFirestore>,
  input: { guarantee: number; parentLimit: number; activeTeachers: number },
) => {
  fake.documents.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-1' })
  fake.documents.set('organizations/parent-1', { type: 'parentOrg', planId: 'PARENT' })
  fake.documents.set('planDefinitions/PARENT', { limits: { teacherSeats: input.parentLimit } })
  fake.documents.set('organizations/parent-1/schoolAllocations/school-1', {
    guaranteedConcurrentLessonsAndMarkets: 0,
    guaranteedTeacherSeats: input.guarantee,
  })
  fake.activeTeacherCounts.set('school-1', input.activeTeachers)
}

describe('createInvitation', () => {
  it('normalizes the email and creates a PENDING invitation', async () => {
    const created: Record<string, unknown>[] = []
    const result = await createInvitation({
      findPendingInvitation: async () => null,
      createInvitationDoc: async (orgId, data) => {
        created.push({ orgId, ...data })
        return 'invitation-1'
      },
    }, { orgId: 'org-1', email: 'Teacher@Example.com', role: 'teacher', invitedByUid: 'owner-1' })

    expect(result).toEqual({ invitationId: 'invitation-1' })
    expect(created).toEqual([{
      orgId: 'org-1',
      email: 'teacher@example.com',
      role: 'teacher',
      status: 'PENDING',
      invitedByUid: 'owner-1',
      createdAt: expect.anything(),
    }])
  })

  it('returns the existing PENDING invitation instead of creating a duplicate', async () => {
    const createInvitationDoc = vi.fn()
    const existing = {
      id: 'invitation-1',
      orgId: 'org-1',
      email: 'teacher@example.com',
      role: 'teacher' as const,
      status: 'PENDING' as const,
      invitedByUid: 'owner-1',
      createdAt: 'x',
    }
    const result = await createInvitation(
      { findPendingInvitation: async () => existing, createInvitationDoc },
      { orgId: 'org-1', email: 'teacher@example.com', role: 'teacher', invitedByUid: 'owner-1' },
    )
    expect(result).toEqual({ invitationId: 'invitation-1' })
    expect(createInvitationDoc).not.toHaveBeenCalled()
  })

  it('uses an atomic reservation when concurrent requests create the same invitation', async () => {
    const created = vi.fn(async () => `non-atomic-${created.mock.calls.length}`)
    let reservationId: string | undefined
    const deps = {
      findPendingInvitation: vi.fn(async () => null),
      createInvitationDoc: created,
      reservePendingInvitation: async (_orgId: string, data: { email: string }) => {
        reservationId ??= `invitation:${data.email}`
        return reservationId
      },
    }
    const input = { orgId: 'org-1', email: 'Teacher@Example.com', role: 'teacher' as const, invitedByUid: 'owner-1' }

    const results = await Promise.all([
      createInvitation(deps, input),
      createInvitation(deps, input),
    ])

    expect(results).toEqual([
      { invitationId: 'invitation:teacher@example.com' },
      { invitationId: 'invitation:teacher@example.com' },
    ])
    expect(created).not.toHaveBeenCalled()
  })

  it('returns a legacy random-ID PENDING invitation before reserving a deterministic document', async () => {
    const pendingQuery = {
      where: vi.fn(),
      limit: vi.fn(),
    }
    pendingQuery.where.mockReturnValue(pendingQuery)
    pendingQuery.limit.mockReturnValue(pendingQuery)
    const deterministicRef = { id: 'email:teacher%40example.com' }
    const transaction = {
      get: vi.fn(async (target) => (
        target === pendingQuery
          ? { empty: false, docs: [{ id: 'legacy-random-id' }] }
          : { exists: false }
      )),
      create: vi.fn(),
      set: vi.fn(),
    }
    const db = {
      collection: vi.fn(() => pendingQuery),
      doc: vi.fn(() => deterministicRef),
      runTransaction: vi.fn(async (operation) => operation(transaction)),
    }
    firestore.getFirestore.mockReturnValue(db)

    const result = await createInvitationWithAdminSdk({
      orgId: 'org-1',
      email: 'Teacher@Example.com',
      role: 'teacher',
      invitedByUid: 'owner-1',
    })

    expect(result).toEqual({ invitationId: 'legacy-random-id' })
    expect(transaction.create).not.toHaveBeenCalled()
    expect(transaction.set).not.toHaveBeenCalled()
  })
})

describe('acceptInvitation', () => {
  const pending = {
    id: 'invitation-1',
    orgId: 'org-1',
    email: 'teacher@example.com',
    role: 'teacher' as const,
    status: 'PENDING' as const,
    invitedByUid: 'owner-1',
    createdAt: 'x',
  }

  it('rejects when the caller email does not match the invitation', async () => {
    await expect(acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => null,
      syncMembership: vi.fn(),
      markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'other@example.com' }))
      .rejects.toThrow('あなた宛の招待ではありません')
  })

  it('rejects when the invitation is not PENDING', async () => {
    await expect(acceptInvitation({
      getInvitation: async () => ({ ...pending, status: 'ACCEPTED' }),
      getMembership: async () => null,
      syncMembership: vi.fn(),
      markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' }))
      .rejects.toThrow('この招待は既に処理されています')
  })

  it('syncs membership and marks the invitation accepted for a new member', async () => {
    const syncMembership = vi.fn()
    const markInvitationAccepted = vi.fn()
    const result = await acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => null,
      syncMembership,
      markInvitationAccepted,
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })

    expect(result).toEqual({ status: 'ACCEPTED' })
    expect(syncMembership).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'uid-2',
      role: 'teacher',
      status: 'active',
      membershipVersion: 1,
      revokedAtSeconds: 0,
    })
    expect(markInvitationAccepted).toHaveBeenCalledWith('org-1', 'invitation-1')
  })

  it('does not re-sync membership when the caller is already an active member', async () => {
    const syncMembership = vi.fn()
    const markInvitationAccepted = vi.fn()
    const reserveTeacherSeat = vi.fn()
    const result = await acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => ({ status: 'active' }),
      reserveTeacherSeat,
      syncMembership,
      markInvitationAccepted,
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })

    expect(result).toEqual({ status: 'ALREADY_MEMBER' })
    expect(reserveTeacherSeat).not.toHaveBeenCalled()
    expect(syncMembership).not.toHaveBeenCalled()
    expect(markInvitationAccepted).toHaveBeenCalledWith('org-1', 'invitation-1')
  })

  it('rejects a new teacher when the teacher-seat resource is restricted', async () => {
    const syncMembership = vi.fn()
    const reserveTeacherSeat = vi.fn()
    await expect(acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => null,
      getDowngradeStatus: async () => ({
        state: 'RESTRICTED',
        violations: [{ key: 'teacherSeats', label: '教師席', used: 2, limit: 1 }],
      }),
      reserveTeacherSeat,
      syncMembership,
      markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' }))
      .rejects.toThrow('教師席を整理する必要があります')
    expect(reserveTeacherSeat).not.toHaveBeenCalled()
    expect(syncMembership).not.toHaveBeenCalled()
  })

  it('does not sync or accept the invitation when shared teacher quota is exhausted', async () => {
    const syncMembership = vi.fn()
    const markInvitationAccepted = vi.fn()
    await expect(acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => null,
      getDowngradeStatus: async () => ({ state: 'NORMAL', violations: [] }),
      reserveTeacherSeat: async () => { throw new Error('共有枠が不足しています') },
      syncMembership,
      markInvitationAccepted,
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' }))
      .rejects.toEqual(new Error('共有枠が不足しています'))

    expect(syncMembership).not.toHaveBeenCalled()
    expect(markInvitationAccepted).not.toHaveBeenCalled()
  })

  it('allows an admin invitation even when teacher seats are restricted', async () => {
    const adminInvitation = { ...pending, role: 'admin' as const }
    const result = await acceptInvitation({
      getInvitation: async () => adminInvitation,
      getMembership: async () => null,
      getDowngradeStatus: async () => ({
        state: 'RESTRICTED',
        violations: [{ key: 'teacherSeats', label: '教師席', used: 2, limit: 1 }],
      }),
      syncMembership: vi.fn(),
      markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })

    expect(result).toEqual({ status: 'ACCEPTED' })
  })
})

describe('reserveTeacherSeatForInvitation', () => {
  it('does not reserve parent shared quota when active usage plus the new teacher is within guarantee', async () => {
    const fake = makeQuotaFirestore()
    seedLinkedSchoolTeacherQuota(fake, { guarantee: 2, parentLimit: 3, activeTeachers: 1 })

    await expect(reserveTeacherSeatForInvitation({
      firestore: fake,
      now: () => 'NOW',
    }, { schoolOrgId: 'school-1', teacherUid: 'uid-2' })).resolves.toEqual({ alreadyActive: false })

    expect(fake.writes).toEqual([])
    expect(fake.collectionReads).toEqual([])
    expect(fake.documentReads).not.toContain('organizations/parent-1')
    expect(fake.documentReads).not.toContain('planDefinitions/PARENT')
  })

  it('creates one deterministic reservation when active usage plus the new teacher exceeds guarantee', async () => {
    const fake = makeQuotaFirestore()
    seedLinkedSchoolTeacherQuota(fake, { guarantee: 1, parentLimit: 3, activeTeachers: 1 })

    const input = { schoolOrgId: 'school-1', teacherUid: 'uid-2' }
    await reserveTeacherSeatForInvitation({ firestore: fake, now: () => 'NOW' }, input)
    await reserveTeacherSeatForInvitation({ firestore: fake, now: () => 'LATER' }, input)

    const reservationPath = 'organizations/parent-1/quotaReservations/teacherSeats:school-1:uid-2'
    expect(fake.documents.get(reservationPath)).toEqual({
      reservationId: 'teacherSeats:school-1:uid-2',
      resourceKey: 'teacherSeats',
      schoolOrgId: 'school-1',
      targetId: 'uid-2',
      createdAt: 'NOW',
    })
    expect(fake.writes).toEqual([reservationPath])
    expect(fake.collectionReads).toEqual([
      'organizations/parent-1/schoolAllocations',
      'organizations/parent-1/quotaReservations',
      'organizations/parent-1/schoolAllocations',
      'organizations/parent-1/quotaReservations',
    ])
  })

  it('throws a pure Error and writes nothing when parent shared teacher quota is exhausted', async () => {
    const fake = makeQuotaFirestore()
    seedLinkedSchoolTeacherQuota(fake, { guarantee: 1, parentLimit: 2, activeTeachers: 1 })
    fake.documents.set('organizations/parent-1/schoolAllocations/school-2', {
      guaranteedConcurrentLessonsAndMarkets: 0,
      guaranteedTeacherSeats: 1,
    })

    await expect(reserveTeacherSeatForInvitation({
      firestore: fake,
    }, { schoolOrgId: 'school-1', teacherUid: 'uid-2' })).rejects.toEqual(new Error('共有枠が不足しています'))

    expect(fake.writes).toEqual([])
    expect(fake.documents.has('organizations/parent-1/quotaReservations/teacherSeats:school-1:uid-2')).toBe(false)
  })

  it('does not reserve when the teacher became active before the quota transaction', async () => {
    const fake = makeQuotaFirestore()
    seedLinkedSchoolTeacherQuota(fake, { guarantee: 0, parentLimit: 1, activeTeachers: 1 })
    fake.documents.set('organizations/school-1/members/uid-2', { role: 'teacher', status: 'active' })

    await expect(reserveTeacherSeatForInvitation({
      firestore: fake,
    }, { schoolOrgId: 'school-1', teacherUid: 'uid-2' })).resolves.toEqual({ alreadyActive: true })

    expect(fake.writes).toEqual([])
    expect(fake.collectionReads).toEqual([])
  })
})

describe('listMyInvitations', () => {
  it('queries pending invitations by the normalized caller email', async () => {
    const queryPendingInvitationsByEmail = vi.fn(async () => [])
    await listMyInvitations({ queryPendingInvitationsByEmail }, { email: 'Teacher@Example.com' })
    expect(queryPendingInvitationsByEmail).toHaveBeenCalledWith('teacher@example.com')
  })
})
