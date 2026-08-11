export type LimitKey = 'concurrentLessonsAndMarkets' | 'teacherSeats'

export interface LimitViolation {
  key: LimitKey
  label: string
  used: number
  limit: number
}

export interface PendingPlanChange {
  planId: string
  effectiveAtMillis: number
}

export interface DowngradeStatus {
  state: 'SCHEDULED' | 'NORMAL' | 'GRACE' | 'RESTRICTED'
  pendingPlanChange?: PendingPlanChange
  graceEndsAtMillis?: number
  violations: LimitViolation[]
}

export interface DeriveDowngradeStatusInput {
  nowMillis: number
  graceEndsAtMillis?: number | null
  pending: PendingPlanChange | null
  violations: LimitViolation[]
}

export const deriveDowngradeStatus = ({
  nowMillis,
  graceEndsAtMillis,
  pending,
  violations,
}: DeriveDowngradeStatusInput): DowngradeStatus => {
  if (pending) return { state: 'SCHEDULED', pendingPlanChange: pending, violations }
  if (violations.length === 0) return { state: 'NORMAL', violations }

  const state = graceEndsAtMillis != null && nowMillis < graceEndsAtMillis ? 'GRACE' : 'RESTRICTED'
  return {
    state,
    ...(graceEndsAtMillis != null ? { graceEndsAtMillis } : {}),
    violations,
  }
}

export const canIncreaseLimitedResource = (status: DowngradeStatus, key: LimitKey): boolean =>
  status.state !== 'RESTRICTED' || !status.violations.some((violation) => violation.key === key)
