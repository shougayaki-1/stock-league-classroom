import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'firebase/database'
import { ENDED_SETTLE_MS, HIDDEN_IDLE_MS, OFFLINE_GRACE_MS, useDatabaseConnected, useDatabaseOffline, useReleaseIdleConnection } from './connectionState'

const listeners = new Set<(snapshot: { val: () => unknown }) => void>()
const emit = (connected: boolean) => listeners.forEach((callback) => callback({ val: () => connected }))
const goOffline = vi.fn()
const goOnline = vi.fn()

vi.mock('firebase/database', () => ({
  goOffline: (...args: unknown[]) => goOffline(...args),
  goOnline: (...args: unknown[]) => goOnline(...args),
  ref: (_database: unknown, path: string) => ({ path }),
  onValue: (_reference: unknown, callback: (snapshot: { val: () => unknown }) => void) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  },
}))

const database = {} as Database
let visibility: DocumentVisibilityState = 'visible'
const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  listeners.clear()
  goOffline.mockClear()
  goOnline.mockClear()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useDatabaseOffline', () => {
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

  it('never blames a release we asked for', () => {
    const { result } = renderHook(() => useDatabaseOffline(database, { suspended: true }))
    act(() => emit(false))
    act(() => { vi.advanceTimersByTime(OFFLINE_GRACE_MS * 3) })
    expect(result.current).toBe(false)
  })
})

describe('useReleaseIdleConnection', () => {
  it('keeps the connection through a momentary switch away', () => {
    const { result } = renderHook(() => useReleaseIdleConnection(database))
    act(() => setVisibility('hidden'))
    act(() => { vi.advanceTimersByTime(HIDDEN_IDLE_MS - 1) })
    expect(goOffline).not.toHaveBeenCalled()
    act(() => setVisibility('visible'))
    act(() => { vi.advanceTimersByTime(HIDDEN_IDLE_MS * 2) })
    expect(goOffline).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  it('releases the connection once the tab has been away long enough', () => {
    const { result } = renderHook(() => useReleaseIdleConnection(database))
    act(() => setVisibility('hidden'))
    act(() => { vi.advanceTimersByTime(HIDDEN_IDLE_MS) })
    expect(goOffline).toHaveBeenCalledWith(database)
    expect(result.current).toBe(true)
    act(() => setVisibility('visible'))
    expect(goOnline).toHaveBeenCalledWith(database)
    expect(result.current).toBe(false)
  })

  it('lets a finished market settle, then releases without waiting to be hidden', () => {
    const { result } = renderHook(() => useReleaseIdleConnection(database, { finished: true }))
    act(() => { vi.advanceTimersByTime(ENDED_SETTLE_MS - 1) })
    expect(goOffline).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(goOffline).toHaveBeenCalledWith(database)
    expect(result.current).toBe(true)
  })

  it('restores the shared connection on unmount so the next screen works', () => {
    const { unmount } = renderHook(() => useReleaseIdleConnection(database))
    act(() => setVisibility('hidden'))
    act(() => { vi.advanceTimersByTime(HIDDEN_IDLE_MS) })
    unmount()
    expect(goOnline).toHaveBeenCalledWith(database)
  })
})

describe('useDatabaseConnected', () => {
  it('tracks reconnection so presence can be re-armed each time', () => {
    const { result } = renderHook(() => useDatabaseConnected(database))
    expect(result.current).toBe(false)
    act(() => emit(true))
    expect(result.current).toBe(true)
    // A drop and recovery must produce a fresh true, or the student stays
    // marked absent for the rest of the lesson.
    act(() => emit(false))
    expect(result.current).toBe(false)
    act(() => emit(true))
    expect(result.current).toBe(true)
  })
})
