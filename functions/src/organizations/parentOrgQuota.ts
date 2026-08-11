export type QuotaResourceKey = 'concurrentLessonsAndMarkets' | 'teacherSeats'

export interface SchoolQuotaAllocation {
  schoolOrgId: string
  guaranteedConcurrentLessonsAndMarkets: number
  guaranteedTeacherSeats: number
}

export interface QuotaReservation {
  reservationId: string
  resourceKey: QuotaResourceKey
  schoolOrgId: string
  targetId: string
}

interface ReserveSharedQuotaInput {
  resourceKey: QuotaResourceKey
  parentLimit: number
  allocations: SchoolQuotaAllocation[]
  reservations: QuotaReservation[]
  schoolOrgId: string
  targetId: string
  currentUsage: number
}

interface ValidateAllocationChangeInput {
  resourceKey: QuotaResourceKey
  parentLimit: number
  allocations: SchoolQuotaAllocation[]
  reservations: QuotaReservation[]
}

const guaranteeFor = (allocation: SchoolQuotaAllocation, resourceKey: QuotaResourceKey): number =>
  resourceKey === 'concurrentLessonsAndMarkets'
    ? allocation.guaranteedConcurrentLessonsAndMarkets
    : allocation.guaranteedTeacherSeats

const reservationIdFor = (resourceKey: QuotaResourceKey, schoolOrgId: string, targetId: string): string =>
  `${resourceKey}:${schoolOrgId}:${targetId}`

export const reserveSharedQuota = (input: ReserveSharedQuotaInput): QuotaReservation | null => {
  const allocation = input.allocations.find(({ schoolOrgId }) => schoolOrgId === input.schoolOrgId)
  if (!allocation) throw new Error('この学校の配分が見つかりません')
  const guarantee = guaranteeFor(allocation, input.resourceKey)
  if (input.currentUsage <= guarantee) return null

  const reservationId = reservationIdFor(input.resourceKey, input.schoolOrgId, input.targetId)
  const existing = input.reservations.find(({ reservationId: id }) => id === reservationId)
  if (existing) return existing

  validateAllocationChange(input)
  const reserved = input.reservations.filter(({ resourceKey }) => resourceKey === input.resourceKey).length
  const guaranteed = input.allocations.reduce((sum, item) => sum + guaranteeFor(item, input.resourceKey), 0)
  if (input.parentLimit - guaranteed - reserved <= 0) throw new Error('共有枠が不足しています')

  return { reservationId, resourceKey: input.resourceKey, schoolOrgId: input.schoolOrgId, targetId: input.targetId }
}

export const releaseSharedQuota = (
  reservations: QuotaReservation[],
  resourceKey: QuotaResourceKey,
  schoolOrgId: string,
  targetId: string,
): QuotaReservation[] => {
  const reservationId = reservationIdFor(resourceKey, schoolOrgId, targetId)
  return reservations.filter(({ reservationId: id }) => id !== reservationId)
}

export const validateAllocationChange = (input: ValidateAllocationChangeInput): void => {
  const guaranteed = input.allocations.reduce((sum, item) => sum + guaranteeFor(item, input.resourceKey), 0)
  if (guaranteed > input.parentLimit) throw new Error('最低保証の合計が上位組織の上限を超えています')

  const reserved = input.reservations.filter(({ resourceKey }) => resourceKey === input.resourceKey).length
  if (guaranteed + reserved > input.parentLimit) throw new Error('既存予約を維持できません')
}
