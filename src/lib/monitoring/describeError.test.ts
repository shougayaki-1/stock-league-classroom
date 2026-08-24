import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeError } from './describeError'

describe('describeError', () => {
  it('explains a permission failure without teacher/market-specific assumptions', () => {
    expect(describeError({ code: 'permission-denied' }, '失敗しました。')).toContain('権限')
    expect(describeError({ code: 'PERMISSION_DENIED' }, '失敗しました。')).not.toContain('市場')
  })
  it('explains a connectivity failure', () => {
    expect(describeError({ code: 'unavailable' }, '失敗しました。')).toContain('通信')
  })
  it('explains a quota failure', () => {
    expect(describeError({ code: 'resource-exhausted' }, '失敗しました。')).toContain('上限')
  })
  it('falls back to the caller message for anything else', () => {
    expect(describeError(new Error('boom'), '失敗しました。')).toBe('失敗しました。')
    expect(describeError(undefined, '失敗しました。')).toBe('失敗しました。')
  })
  it('never exposes the raw message for an unclassified error', () => {
    const raw = 'backend collection lessonRuns/private-path failed'
    const result = describeError(new Error(raw), '操作に失敗しました。')

    expect(result).toBe('操作に失敗しました。')
    expect(result).not.toContain(raw)
  })
})

const reportError = vi.fn()
vi.mock('./errorReporting', () => ({ reportError: (error: unknown) => reportError(error) }))

describe('handleFailure', () => {
  afterEach(() => {
    reportError.mockClear()
    vi.resetModules()
  })

  it('reports a repeated identical failure only once within the cooldown window', async () => {
    const { handleFailure } = await import('./describeError')
    let clock = 0
    const now = () => clock
    const error = { code: 'unavailable' }

    const first = handleFailure(error, '失敗しました。', now)
    clock += 30_000
    const second = handleFailure(error, '失敗しました。', now)

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('still reports a different failure inside the same window', async () => {
    const { handleFailure } = await import('./describeError')
    let clock = 0
    const now = () => clock

    handleFailure({ code: 'unavailable' }, '失敗しました。', now)
    clock += 1_000
    handleFailure({ code: 'permission-denied' }, '失敗しました。', now)

    expect(reportError).toHaveBeenCalledTimes(2)
  })

  it('reports the same failure again once the cooldown window elapses', async () => {
    const { handleFailure } = await import('./describeError')
    let clock = 0
    const now = () => clock
    const error = { code: 'unavailable' }

    handleFailure(error, '失敗しました。', now)
    clock += 60_000
    handleFailure(error, '失敗しました。', now)

    expect(reportError).toHaveBeenCalledTimes(2)
  })

  it('returns the same message whether or not the report was throttled', async () => {
    const { handleFailure, describeError } = await import('./describeError')
    let clock = 0
    const now = () => clock
    const error = { code: 'unavailable' }
    const expected = describeError(error, '失敗しました。')

    const reported = handleFailure(error, '失敗しました。', now)
    clock += 1_000
    const throttled = handleFailure(error, '失敗しました。', now)

    expect(reported).toBe(expected)
    expect(throttled).toBe(expected)
  })
})
