import { describe, expect, it } from 'vitest'
import { canIncreaseLimitedResource, deriveDowngradeStatus, type LimitViolation } from './downgradeEnforcement'

const runViolation: LimitViolation = {
  key: 'concurrentLessonsAndMarkets',
  label: '同時授業・市場数',
  used: 2,
  limit: 1,
}

const teacherViolation: LimitViolation = {
  key: 'teacherSeats',
  label: '教師席',
  used: 3,
  limit: 1,
}

describe('deriveDowngradeStatus', () => {
  it('prioritizes a scheduled plan change over current violations', () => {
    expect(deriveDowngradeStatus({
      nowMillis: 199,
      graceEndsAtMillis: 200,
      pending: { planId: 'SCHOOL', effectiveAtMillis: 300 },
      violations: [runViolation],
    })).toEqual({
      state: 'SCHEDULED',
      pendingPlanChange: { planId: 'SCHOOL', effectiveAtMillis: 300 },
      violations: [runViolation],
    })
  })

  it('returns NORMAL when there are no violations', () => {
    expect(deriveDowngradeStatus({ nowMillis: 500, graceEndsAtMillis: 200, pending: null, violations: [] })).toEqual({
      state: 'NORMAL',
      violations: [],
    })
  })

  it('returns GRACE immediately before the grace deadline and RESTRICTED at the deadline', () => {
    expect(deriveDowngradeStatus({ nowMillis: 199, graceEndsAtMillis: 200, pending: null, violations: [runViolation] }).state).toBe('GRACE')
    expect(deriveDowngradeStatus({ nowMillis: 200, graceEndsAtMillis: 200, pending: null, violations: [runViolation] }).state).toBe('RESTRICTED')
  })
})

describe('canIncreaseLimitedResource', () => {
  it('blocks only a resource that is over its limit in RESTRICTED state', () => {
    const restrictedTeacherStatus = deriveDowngradeStatus({
      nowMillis: 200,
      graceEndsAtMillis: 200,
      pending: null,
      violations: [runViolation, teacherViolation],
    })

    expect(canIncreaseLimitedResource(restrictedTeacherStatus, 'teacherSeats')).toBe(false)
    expect(canIncreaseLimitedResource(restrictedTeacherStatus, 'concurrentLessonsAndMarkets')).toBe(false)
  })

  it('allows all resource increases outside RESTRICTED state', () => {
    const graceStatus = deriveDowngradeStatus({
      nowMillis: 199,
      graceEndsAtMillis: 200,
      pending: null,
      violations: [runViolation],
    })

    expect(canIncreaseLimitedResource(graceStatus, 'concurrentLessonsAndMarkets')).toBe(true)
    expect(canIncreaseLimitedResource(graceStatus, 'teacherSeats')).toBe(true)
  })
})
