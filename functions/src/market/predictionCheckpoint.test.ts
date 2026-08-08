import { describe, expect, it, vi } from 'vitest'
import { resolvePredictionCheckpoint, submitPrediction } from './predictionCheckpoint'

const checkpoint = (overrides: Record<string, unknown> = {}) => ({
  id: 'pred-1', direction: 'UP' as const, submittedAtBatchIndex: 10, submittedPriceReference: 1000,
  evaluationTarget: { type: 'AFTER_BATCHES' as const, count: 20 },
  ...overrides,
})

describe('resolvePredictionCheckpoint', () => {
  it('is NOT resolvable before the target batch is reached (AFTER_BATCHES)', () => {
    const result = resolvePredictionCheckpoint(checkpoint(), { currentBatchIndex: 25, priceAtBatchIndex: () => 1100 })
    expect(result.resolved).toBe(false)
  })

  it('resolves at exactly submittedAtBatchIndex + count, comparing against that batch\'s settled price', () => {
    const result = resolvePredictionCheckpoint(checkpoint(), { currentBatchIndex: 30, priceAtBatchIndex: (i: number) => (i === 30 ? 1100 : 999) })
    expect(result.resolved).toBe(true)
    if (result.resolved) {
      expect(result.resolvedPrice).toBe(1100)
      expect(result.outcome).toBe('CORRECT') // predicted UP, price rose
    }
  })

  it('classifies a prediction within ±0.5% of the reference price as FLAT regardless of predicted direction', () => {
    const flatCheckpoint = checkpoint({ direction: 'FLAT' })
    const result = resolvePredictionCheckpoint(flatCheckpoint, { currentBatchIndex: 30, priceAtBatchIndex: () => 1002 })
    expect(result.resolved).toBe(true)
    if (result.resolved) expect(result.outcome).toBe('CORRECT')
  })

  it('marks a wrong-direction prediction INCORRECT', () => {
    const result = resolvePredictionCheckpoint(checkpoint({ direction: 'UP' }), { currentBatchIndex: 30, priceAtBatchIndex: () => 900 })
    expect(result.resolved).toBe(true)
    if (result.resolved) expect(result.outcome).toBe('INCORRECT')
  })

  it('resolves NEXT_INFORMATION targets when the next information item\'s batch index is known', () => {
    const target = checkpoint({ evaluationTarget: { type: 'NEXT_INFORMATION' } })
    const notYet = resolvePredictionCheckpoint(target, { currentBatchIndex: 15, priceAtBatchIndex: () => 1000 })
    expect(notYet.resolved).toBe(false)
    const resolved = resolvePredictionCheckpoint(target, {
      currentBatchIndex: 18, priceAtBatchIndex: () => 1050, nextInformationBatchIndex: 18,
    })
    expect(resolved.resolved).toBe(true)
  })

  it('resolves MARKET_CLOSE targets only once the market has closed', () => {
    const target = checkpoint({ evaluationTarget: { type: 'MARKET_CLOSE' } })
    const notYet = resolvePredictionCheckpoint(target, { currentBatchIndex: 100, priceAtBatchIndex: () => 1000, marketClosed: false })
    expect(notYet.resolved).toBe(false)
    const resolved = resolvePredictionCheckpoint(target, { currentBatchIndex: 100, priceAtBatchIndex: () => 1200, marketClosed: true })
    expect(resolved.resolved).toBe(true)
  })
})

describe('submitPrediction', () => {
  const baseInput = {
    lessonRunId: 'run-1', teamId: 'team-a', participantId: 'p-1',
    direction: 'UP' as const, submittedAtBatchIndex: 10, submittedPriceReference: 1000,
    evaluationTarget: { type: 'AFTER_BATCHES' as const, count: 20 },
    idempotencyKey: 'idem-1',
  }

  it('delegates to createPrediction with the full submission and returns its result', async () => {
    const createPrediction = vi.fn().mockResolvedValue({ predictionId: 'pred-1', created: true })
    const result = await submitPrediction({ ...baseInput, createPrediction })
    expect(result).toEqual({ predictionId: 'pred-1', created: true })
    expect(createPrediction).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', teamId: 'team-a', participantId: 'p-1', direction: 'UP',
      submittedAtBatchIndex: 10, submittedPriceReference: 1000,
      evaluationTarget: { type: 'AFTER_BATCHES', count: 20 }, idempotencyKey: 'idem-1',
    }))
  })

  it('replays the same idempotencyKey without creating a duplicate (delegated to createPrediction)', async () => {
    const createPrediction = vi.fn().mockResolvedValue({ predictionId: 'pred-1', created: false })
    const result = await submitPrediction({ ...baseInput, createPrediction })
    expect(result).toEqual({ predictionId: 'pred-1', created: false })
  })
})
