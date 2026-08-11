import type { QuotaReservation, QuotaResourceKey, SchoolQuotaAllocation } from './parentOrgQuota'

export interface QuotaDocument {
  id: string
  data: () => Record<string, unknown>
}

export const allocationFromQuotaDocument = (document: QuotaDocument): SchoolQuotaAllocation => {
  const data = document.data()
  return {
    schoolOrgId: document.id,
    guaranteedConcurrentLessonsAndMarkets: Number(data.guaranteedConcurrentLessonsAndMarkets ?? 0),
    guaranteedTeacherSeats: Number(data.guaranteedTeacherSeats ?? 0),
  }
}

export const reservationFromQuotaDocument = (document: QuotaDocument): QuotaReservation | null => {
  const data = document.data()
  const resourceKey = data.resourceKey
  if (resourceKey !== 'concurrentLessonsAndMarkets' && resourceKey !== 'teacherSeats') return null
  if (typeof data.schoolOrgId !== 'string' || typeof data.targetId !== 'string') return null
  return {
    reservationId: document.id,
    resourceKey,
    schoolOrgId: data.schoolOrgId,
    targetId: data.targetId,
  }
}

export const quotaReservationDocumentPath = (
  parentOrgId: string,
  resourceKey: QuotaResourceKey,
  schoolOrgId: string,
  targetId: string,
): string => `organizations/${parentOrgId}/quotaReservations/${resourceKey}:${schoolOrgId}:${targetId}`
