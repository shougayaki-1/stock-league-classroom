export type OrderStatus = 'PENDING' | 'CANCELLED' | 'PROCESSING' | 'FILLED' | 'REJECTED'

/**
 * Firestore document shape at `lessonRuns/{lessonRunId}/orders/{orderId}` —
 * spec §12.12. `submittedAtServerMillis`/`settledAtServerMillis` are plain
 * epoch millis (not Firestore `Timestamp`) to keep the repository testable
 * with an injected `now: () => number`, matching the rest of Phase A/B
 * (e.g. `appendLessonEvent`'s injectable `now`).
 */
export interface MarketOrder {
  orderId: string
  idempotencyKey: string
  lessonRunId: string
  batchId: string
  participantId?: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  status: OrderStatus
  submittedAtServerMillis: number
  settledAtServerMillis?: number
  executionPrice?: number
  rejectionReason?: string
}
