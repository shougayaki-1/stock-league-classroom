import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'firebase/database'
import { OFFLINE_GRACE_MS, useDatabaseOffline } from './connectionState'

let emit: (connected: boolean) => void = () => {}
const stop = vi.fn()

vi.mock('firebase/database', () => ({
  ref: (_database: unknown, path: string) => ({ path }),
  onValue: (_reference: unknown, callback: (snapshot: { val: () => unknown }) => void) => {
    emit = (connected: boolean) => callback({ val: () => connected })
    return stop
  },
}))

const database = {} as Database

describe('useDatabaseOffline', () => {
  beforeEach(() => { vi.useFakeTimers(); stop.mockClear() })
  afterEach(() => vi.useRealTimers())

  it('does not report a brief reconnect blip as an outage', () => {
    const { result } = renderHook(() => useDatabaseOffline(database))
    act(() => emit(false))
    act(() => { vi.advanceTimersByTime(OFFLINE_GRACE_MS - 1) })
    expect(result.current).toBe(false)
    act(() => emit(true))
    act(() => { vi.advanceTimersByTime(OFFLINE_GRACE_MS * 2) })
    expect(result.current).toBe(false)
  })

  it('reports an outage once the disconnection outlasts the grace period', () => {
    const { result } = renderHook(() => useDatabaseOffline(database))
    act(() => emit(false))
    act(() => { vi.advanceTimersByTime(OFFLINE_GRACE_MS) })
    expect(result.current).toBe(true)
  })

  it('clears once the connection returns', () => {
    const { result } = renderHook(() => useDatabaseOffline(database))
    act(() => emit(false))
    act(() => { vi.advanceTimersByTime(OFFLINE_GRACE_MS) })
    expect(result.current).toBe(true)
    act(() => emit(true))
    expect(result.current).toBe(false)
  })

  it('detaches the listener and its pending timer on unmount', () => {
    const { unmount } = renderHook(() => useDatabaseOffline(database))
    act(() => emit(false))
    unmount()
    expect(stop).toHaveBeenCalled()
  })
})
