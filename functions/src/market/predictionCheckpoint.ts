import { getFirestore } from 'firebase-admin/firestore'
import type { PredictionEvaluationTarget } from '@stock-league/market-authoring-content'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

export type PredictionDirection = 'UP' | 'FLAT' | 'DOWN'

export interface PredictionCheckpoint {
  id: string
  direction: PredictionDirection
  submittedAtBatchIndex: number
  submittedPriceReference: number
  evaluationTarget: PredictionEvaluationTarget
  /** Usually the news/earnings information item that triggered this
   * checkpoint — spec resolution F's `triggeredByInformationId`. */
  triggeredByInformationId?: string
  rationale?: string
  confidence?: number
}

export interface ResolutionContext {
  currentBatchIndex: number
  priceAtBatchIndex: (batchIndex: number) => number
  nextInformationBatchIndex?: number
  marketClosed?: boolean
}

export type PredictionResolution =
  | { resolved: false }
  | { resolved: true; resolvedPrice: number; outcome: 'CORRECT' | 'INCORRECT' }

/** Flat band: within ±0.5% counts as FLAT regardless of predicted
 * direction. PROVISIONAL — no spec default exists for this band; chosen
 * to roughly match §12.22's noise magnitude so pure noise never scores a
 * FLAT prediction as wrong. */
export const FLAT_BAND_PERCENT = 0.5

const classify = (direction: PredictionDirection, referencePrice: number, resolvedPrice: number): 'CORRECT' | 'INCORRECT' => {
  const changePercent = ((resolvedPrice - referencePrice) / referencePrice) * 100
  const actual: PredictionDirection = Math.abs(changePercent) <= FLAT_BAND_PERCENT
    ? 'FLAT' : changePercent > 0 ? 'UP' : 'DOWN'
  return actual === direction ? 'CORRECT' : 'INCORRECT'
}

/**
 * Resolves a prediction checkpoint against its explicit `evaluationTarget`
 * (spec resolution F / §12.32) — never inferred from trade history. Each
 * branch answers "is the evaluation batch known yet?" before comparing
 * prices, so an unresolved checkpoint never fabricates a resolution.
 */
export const resolvePredictionCheckpoint = (
  checkpoint: PredictionCheckpoint,
  context: ResolutionContext,
): PredictionResolution => {
  const target = checkpoint.evaluationTarget
  let resolvedAtBatchIndex: number | undefined

  if (target.type === 'AFTER_BATCHES') {
    const targetBatchIndex = checkpoint.submittedAtBatchIndex + target.count
    if (context.currentBatchIndex < targetBatchIndex) return { resolved: false }
    resolvedAtBatchIndex = targetBatchIndex
  } else if (target.type === 'NEXT_INFORMATION') {
    if (context.nextInformationBatchIndex === undefined) return { resolved: false }
    resolvedAtBatchIndex = context.nextInformationBatchIndex
  } else {
    if (!context.marketClosed) return { resolved: false }
    resolvedAtBatchIndex = context.currentBatchIndex
  }

  const resolvedPrice = context.priceAtBatchIndex(resolvedAtBatchIndex)
  return { resolved: true, resolvedPrice, outcome: classify(checkpoint.direction, checkpoint.submittedPriceReference, resolvedPrice) }
}

// ---------------------------------------------------------------------
// submitPrediction — Callable-facing submission entry point
// ---------------------------------------------------------------------

export interface CreatePredictionInput {
  lessonRunId: string
  teamId: string
  participantId?: string
  direction: PredictionDirection
  submittedAtBatchIndex: number
  submittedPriceReference: number
  evaluationTarget: PredictionEvaluationTarget
  triggeredByInformationId?: string
  rationale?: string
  confidence?: number
  idempotencyKey: string
}

export interface SubmitPredictionDeps extends CreatePredictionInput {
  createPrediction: (input: CreatePredictionInput) => Promise<{ predictionId: string; created: boolean }>
}

/**
 * Prediction submission entry point — spec §12.32 / resolution F. Pure DI,
 * same shape as `submitOrder.ts`: the Callable boundary (`onCall.ts`) wires
 * `createPrediction` to the Admin SDK and translates thrown `Error`s into
 * `HttpsError`s. Unlike `submitOrder`, there is no market-paused or
 * soft-lock gate here — Task 15's scope is limited to recording the
 * checkpoint itself (idempotently); a submission deadline tied to the
 * first evaluation interval (spec resolution F's "止めない設定") is left
 * to a future task since the brief does not ask for it here.
 */
export const submitPrediction = async (deps: SubmitPredictionDeps): Promise<{ predictionId: string; created: boolean }> => {
  const { createPrediction, ...input } = deps
  return createPrediction(input)
}

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

/**
 * Idempotent per (lessonRunId, idempotencyKey) — same pattern as
 * `lessonRuns/orders/repository.ts`'s `createPendingOrder`: a lookup
 * document at a hashed path records which predictionId a given key already
 * produced, and a stored request digest catches a key being replayed with
 * materially different fields (rejected rather than silently deduplicated).
 * No shared repository file exists for predictions yet (Task 15's Files
 * list is limited to this file + onCall.ts), so the Admin SDK transaction
 * lives here directly, mirroring `pauseMarket.ts`'s `WithAdminSdk` suffix
 * convention rather than introducing a `FirestoreLike` abstraction layer
 * for a single call site.
 */
export const createPredictionCheckpointWithAdminSdk: SubmitPredictionDeps['createPrediction'] = async (input) => {
  const db = getFirestore()
  const idempotencyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const idempotencyRef = db.doc(`lessonRuns/${input.lessonRunId}/predictionIdempotency/${idempotencyId}`)
  const digest = computeRequestDigest({
    teamId: input.teamId, participantId: input.participantId ?? null, direction: input.direction,
    submittedAtBatchIndex: input.submittedAtBatchIndex, submittedPriceReference: input.submittedPriceReference,
    evaluationTarget: input.evaluationTarget, triggeredByInformationId: input.triggeredByInformationId ?? null,
    rationale: input.rationale ?? null, confidence: input.confidence ?? null,
  })

  return db.runTransaction(async (tx) => {
    // All reads before all writes (Firestore transaction requirement) —
    // the idempotency lookup is the only read this transaction needs.
    const existing = await tx.get(idempotencyRef)
    if (existing.exists) {
      const prior = existing.data() as { predictionId: string; requestDigest: string }
      if (prior.requestDigest !== digest) throw new Error('Idempotency key payload mismatch')
      return { predictionId: prior.predictionId, created: false }
    }

    const predictionId = `${input.lessonRunId}_prediction_${idempotencyId}`
    const checkpoint: PredictionCheckpoint & { lessonRunId: string; teamId: string; participantId?: string; idempotencyKey: string } = {
      id: predictionId,
      lessonRunId: input.lessonRunId,
      teamId: input.teamId,
      ...(input.participantId !== undefined ? { participantId: input.participantId } : {}),
      direction: input.direction,
      submittedAtBatchIndex: input.submittedAtBatchIndex,
      submittedPriceReference: input.submittedPriceReference,
      evaluationTarget: input.evaluationTarget,
      ...(input.triggeredByInformationId !== undefined ? { triggeredByInformationId: input.triggeredByInformationId } : {}),
      ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      idempotencyKey: input.idempotencyKey,
    }
    tx.set(db.doc(`lessonRuns/${input.lessonRunId}/predictions/${predictionId}`), checkpoint)
    tx.set(idempotencyRef, { predictionId, requestDigest: digest })
    return { predictionId, created: true }
  })
}
