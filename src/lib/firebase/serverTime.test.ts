import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverNow, setServerTimeOffset } from './serverTime'

afterEach(() => { setServerTimeOffset(0); vi.useRealTimers() })

describe('serverNow', () => {
  it('matches the local clock until an offset is published', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000)
    expect(serverNow()).toBe(1_000)
  })
  it('applies the published offset', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000)
    setServerTimeOffset(4_500)
    expect(serverNow()).toBe(5_500)
    setServerTimeOffset(-2_000)
    expect(serverNow()).toBe(-1_000)
  })
})
