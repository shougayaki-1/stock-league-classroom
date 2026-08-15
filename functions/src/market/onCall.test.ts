import { describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import { handleSubmitOrder } from './onCall'

describe('handleSubmitOrder', () => {
  const validRequest = {
    lessonRunId: 'run-1',
    teamId: 'team-1',
    stockId: 'stock-1',
    side: 'BUY' as const,
    quantity: 10,
    idempotencyKey: 'idem-1',
  }

  const validRun = {
    status: 'RUNNING',
    marketPaused: false,
    currentPhaseId: 'p-market',
    nextBatchId: 'run-1_batch_2',
    templateSnapshot: {
      phases: [{ id: 'p-market', phaseType: 'MARKET' }],
    },
  }

  it('rejects unauthenticated requests', async () => {
    await expect(handleSubmitOrder({
      auth: null,
      data: validRequest,
    }, {
      resolveActorParticipantId: vi.fn(),
      requireTeamMembership: vi.fn(),
      getLessonRun: vi.fn(),
      getStockPrice: vi.fn(),
      getOrInitTeamAccount: vi.fn(),
      submitOrderFn: vi.fn(),
    })).rejects.toThrow(HttpsError)
  })

  it('rejects invalid request arguments', async () => {
    const deps = {
      resolveActorParticipantId: vi.fn(),
      requireTeamMembership: vi.fn(),
      getLessonRun: vi.fn(),
      getStockPrice: vi.fn(),
      getOrInitTeamAccount: vi.fn(),
      submitOrderFn: vi.fn(),
    }

    await expect(handleSubmitOrder({
      auth: { uid: 'u1' } as never,
      data: { ...validRequest, quantity: 0 },
    }, deps)).rejects.toThrow(HttpsError)

    await expect(handleSubmitOrder({
      auth: { uid: 'u1' } as never,
      data: { ...validRequest, side: 'INVALID' as never },
    }, deps)).rejects.toThrow(HttpsError)
  })

  it('rejects order when current phase is not MARKET even if status is RUNNING', async () => {
    const submitOrderFn = vi.fn()
    const deps = {
      resolveActorParticipantId: vi.fn().mockResolvedValue('p1'),
      requireTeamMembership: vi.fn().mockResolvedValue(undefined),
      getLessonRun: vi.fn().mockResolvedValue({
        ...validRun,
        currentPhaseId: 'p-info',
        templateSnapshot: {
          phases: [{ id: 'p-info', phaseType: 'INFORMATION' }],
        },
      }),
      getStockPrice: vi.fn().mockResolvedValue(1000),
      getOrInitTeamAccount: vi.fn().mockResolvedValue(undefined),
      submitOrderFn,
    }

    await expect(handleSubmitOrder({
      auth: { uid: 'u1' } as never,
      data: validRequest,
    }, deps)).rejects.toThrow('市場フェーズ中のみ注文できます。')

    expect(submitOrderFn).not.toHaveBeenCalled()
  })

  it('rejects order when marketPaused is true', async () => {
    const submitOrderFn = vi.fn()
    const deps = {
      resolveActorParticipantId: vi.fn().mockResolvedValue('p1'),
      requireTeamMembership: vi.fn().mockResolvedValue(undefined),
      getLessonRun: vi.fn().mockResolvedValue({
        ...validRun,
        marketPaused: true,
      }),
      getStockPrice: vi.fn().mockResolvedValue(1000),
      getOrInitTeamAccount: vi.fn().mockResolvedValue(undefined),
      submitOrderFn,
    }

    await expect(handleSubmitOrder({
      auth: { uid: 'u1' } as never,
      data: validRequest,
    }, deps)).rejects.toThrow('市場は停止中です。')

    expect(submitOrderFn).not.toHaveBeenCalled()
  })

  it('rejects order when nextBatchId is missing', async () => {
    const submitOrderFn = vi.fn()
    const deps = {
      resolveActorParticipantId: vi.fn().mockResolvedValue('p1'),
      requireTeamMembership: vi.fn().mockResolvedValue(undefined),
      getLessonRun: vi.fn().mockResolvedValue({
        ...validRun,
        nextBatchId: null,
      }),
      getStockPrice: vi.fn().mockResolvedValue(1000),
      getOrInitTeamAccount: vi.fn().mockResolvedValue(undefined),
      submitOrderFn,
    }

    await expect(handleSubmitOrder({
      auth: { uid: 'u1' } as never,
      data: validRequest,
    }, deps)).rejects.toThrow('受付中のバッチがありません。')

    expect(submitOrderFn).not.toHaveBeenCalled()
  })

  it('rejects order when stock does not exist or has invalid price', async () => {
    const submitOrderFn = vi.fn()
    const deps = {
      resolveActorParticipantId: vi.fn().mockResolvedValue('p1'),
      requireTeamMembership: vi.fn().mockResolvedValue(undefined),
      getLessonRun: vi.fn().mockResolvedValue(validRun),
      getStockPrice: vi.fn().mockResolvedValue(null),
      getOrInitTeamAccount: vi.fn().mockResolvedValue(undefined),
      submitOrderFn,
    }

    await expect(handleSubmitOrder({
      auth: { uid: 'u1' } as never,
      data: validRequest,
    }, deps)).rejects.toThrow('株式情報が見つかりません。')

    expect(submitOrderFn).not.toHaveBeenCalled()
  })

  it('resolves batchId from run and referencePrice from stock price', async () => {
    const submitOrderFn = vi.fn().mockResolvedValue({ orderId: 'order-123', created: true })
    const deps = {
      resolveActorParticipantId: vi.fn().mockResolvedValue('p1'),
      requireTeamMembership: vi.fn().mockResolvedValue(undefined),
      getLessonRun: vi.fn().mockResolvedValue(validRun),
      getStockPrice: vi.fn().mockResolvedValue(1500),
      getOrInitTeamAccount: vi.fn().mockResolvedValue(undefined),
      submitOrderFn,
    }

    const result = await handleSubmitOrder({
      auth: { uid: 'u1' } as never,
      data: validRequest,
    }, deps)

    expect(result).toEqual({ orderId: 'order-123', created: true })
    expect(submitOrderFn).toHaveBeenCalledWith({
      lessonRunId: 'run-1',
      batchId: 'run-1_batch_2',
      teamId: 'team-1',
      stockId: 'stock-1',
      side: 'BUY',
      quantity: 10,
      referencePrice: 1500,
      idempotencyKey: 'idem-1',
      actorParticipantId: 'p1',
    })
  })
})
