import { describe, expect, it } from 'vitest'
import {
  releaseSharedQuota,
  reserveSharedQuota,
  validateAllocationChange,
  type QuotaReservation,
  type SchoolQuotaAllocation,
} from './parentOrgQuota'

const allocations: SchoolQuotaAllocation[] = [
  { schoolOrgId: 'school-1', guaranteedConcurrentLessonsAndMarkets: 1, guaranteedTeacherSeats: 1 },
  { schoolOrgId: 'school-2', guaranteedConcurrentLessonsAndMarkets: 1, guaranteedTeacherSeats: 1 },
]

const reservation = (targetId: string): QuotaReservation => ({
  reservationId: `teacherSeats:school-1:${targetId}`,
  resourceKey: 'teacherSeats',
  schoolOrgId: 'school-1',
  targetId,
})

describe('parent organization quota ledger', () => {
  it('rejects a school that does not have a quota allocation', () => {
    expect(() => reserveSharedQuota({
      resourceKey: 'teacherSeats',
      parentLimit: 3,
      allocations,
      reservations: [],
      schoolOrgId: 'unallocated-school',
      targetId: 'teacher-1',
      currentUsage: 1,
    })).toThrow('この学校の配分が見つかりません')
  })

  it('does not reserve shared quota while usage is within the school guarantee', () => {
    expect(reserveSharedQuota({
      resourceKey: 'teacherSeats',
      parentLimit: 3,
      allocations,
      reservations: [],
      schoolOrgId: 'school-1',
      targetId: 'teacher-1',
      currentUsage: 1,
    })).toBeNull()
  })

  it('uses the concurrent lessons and markets guarantee for that resource', () => {
    const allocationsWithDistinctGuarantees: SchoolQuotaAllocation[] = [
      { schoolOrgId: 'school-1', guaranteedConcurrentLessonsAndMarkets: 2, guaranteedTeacherSeats: 1 },
      { schoolOrgId: 'school-2', guaranteedConcurrentLessonsAndMarkets: 1, guaranteedTeacherSeats: 1 },
    ]

    expect(reserveSharedQuota({
      resourceKey: 'concurrentLessonsAndMarkets',
      parentLimit: 4,
      allocations: allocationsWithDistinctGuarantees,
      reservations: [],
      schoolOrgId: 'school-1',
      targetId: 'lesson-run-1',
      currentUsage: 2,
    })).toBeNull()
  })

  it('uses the concurrent lesson and market guarantee field for an overage reservation', () => {
    expect(reserveSharedQuota({
      resourceKey: 'concurrentLessonsAndMarkets',
      parentLimit: 5,
      allocations,
      reservations: [],
      schoolOrgId: 'school-1',
      targetId: 'lesson-run-1',
      currentUsage: 3,
    })).toEqual({
      reservationId: 'concurrentLessonsAndMarkets:school-1:lesson-run-1',
      resourceKey: 'concurrentLessonsAndMarkets',
      schoolOrgId: 'school-1',
      targetId: 'lesson-run-1',
    })
  })

  it('creates a deterministic reservation when usage exceeds the guarantee', () => {
    expect(reserveSharedQuota({
      resourceKey: 'teacherSeats',
      parentLimit: 3,
      allocations,
      reservations: [],
      schoolOrgId: 'school-1',
      targetId: 'teacher-1',
      currentUsage: 2,
    })).toEqual(reservation('teacher-1'))
  })

  it('rejects a reservation when the shared remainder is exhausted', () => {
    expect(() => reserveSharedQuota({
      resourceKey: 'teacherSeats',
      parentLimit: 3,
      allocations,
      reservations: [reservation('teacher-0')],
      schoolOrgId: 'school-1',
      targetId: 'teacher-1',
      currentUsage: 2,
    })).toThrow('共有枠が不足しています')
  })

  it('does not double-reserve the same target', () => {
    expect(reserveSharedQuota({
      resourceKey: 'teacherSeats',
      parentLimit: 3,
      allocations,
      reservations: [reservation('teacher-1')],
      schoolOrgId: 'school-1',
      targetId: 'teacher-1',
      currentUsage: 2,
    })).toEqual(reservation('teacher-1'))
  })

  it('releases only the matching reservation', () => {
    const reservations = [reservation('teacher-1'), reservation('teacher-2')]
    expect(releaseSharedQuota(reservations, 'teacherSeats', 'school-1', 'teacher-1')).toEqual([reservation('teacher-2')])
  })

  it('rejects allocations whose guarantees exceed the parent limit or reservations', () => {
    expect(() => validateAllocationChange({ resourceKey: 'teacherSeats', parentLimit: 1, allocations, reservations: [] }))
      .toThrow('最低保証の合計が上位組織の上限を超えています')
    expect(() => validateAllocationChange({ resourceKey: 'teacherSeats', parentLimit: 3, allocations, reservations: [reservation('teacher-1'), reservation('teacher-2')] }))
      .toThrow('既存予約を維持できません')
  })
})
