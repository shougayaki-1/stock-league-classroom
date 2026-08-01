import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeInterruption, useDocumentHidden, useHostInterruption, useUnloadWarning, useWakeLock } from './hostContinuity'

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { setHidden(false); vi.useRealTimers(); vi.restoreAllMocks() })

describe('useDocumentHidden', () => {
  it('tracks visibility changes', () => {
    const { result } = renderHook(() => useDocumentHidden())
    expect(result.current).toBe(false)
    act(() => setHidden(true))
    expect(result.current).toBe(true)
    act(() => setHidden(false))
    expect(result.current).toBe(false)
  })
})

describe('describeInterruption', () => {
  it('reports the interruption in whole seconds and minutes', () => {
    expect(describeInterruption(0, 8_000)).toBe('8秒')
    expect(describeInterruption(0, 95_000)).toBe('1分35秒')
    expect(describeInterruption(0, 600_000)).toBe('10分0秒')
  })
})

describe('useHostInterruption', () => {
  it('reports exactly one interruption spanning the full hide-to-visible period, even across an unrelated re-render (such as the host lease being lost while still hidden)', () => {
    const { result, rerender } = renderHook(() => useHostInterruption())
    act(() => setHidden(true))
    vi.setSystemTime(5_000)
    // Simulate the parent re-rendering because something unrelated changed
    // (e.g. HostConsole clearing the lease after runHostTick returns false).
    // This must not clear the tracked hide time or report anything yet.
    rerender()
    expect(result.current.message).toBeNull()
    vi.setSystemTime(20_000)
    act(() => setHidden(false))
    expect(result.current.message).toBe('20秒')
  })

  it('reports a fresh interruption on every hide/return cycle, and a dismissal never suppresses a later one', () => {
    const { result } = renderHook(() => useHostInterruption())

    act(() => setHidden(true))
    vi.setSystemTime(10_000)
    act(() => setHidden(false))
    expect(result.current.message).toBe('10秒')

    act(() => result.current.dismiss())
    expect(result.current.message).toBeNull()

    vi.setSystemTime(15_000)
    act(() => setHidden(true))
    vi.setSystemTime(45_000)
    act(() => setHidden(false))
    expect(result.current.message).toBe('30秒')
  })

  it('starts tracking immediately when mounted while the tab is already hidden', () => {
    setHidden(true)
    vi.setSystemTime(3_000)
    const { result } = renderHook(() => useHostInterruption())
    vi.setSystemTime(8_000)
    act(() => setHidden(false))
    expect(result.current.message).toBe('5秒')
  })

  it('produces no message while still hidden, and does not report twice for one return', () => {
    const { result } = renderHook(() => useHostInterruption())
    act(() => setHidden(true))
    expect(result.current.message).toBeNull()
    vi.setSystemTime(12_000)
    act(() => setHidden(false))
    expect(result.current.message).toBe('12秒')
    // Re-dispatching visibilitychange without an actual state change must not
    // re-report.
    act(() => setHidden(false))
    expect(result.current.message).toBe('12秒')
  })
})

describe('useUnloadWarning', () => {
  it('registers a beforeunload listener only while active, and removes it on cleanup', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { rerender, unmount } = renderHook(({ active }) => useUnloadWarning(active), { initialProps: { active: false } })
    expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))

    rerender({ active: true })
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    rerender({ active: false })
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    unmount()
  })
})

describe('useWakeLock', () => {
  it('does not throw when navigator.wakeLock is unsupported (the jsdom case)', () => {
    expect('wakeLock' in navigator).toBe(false)
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow()
  })

  it('releases the sentinel once active goes false', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const sentinel = { release }
    const request = vi.fn().mockResolvedValue(sentinel)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })

    const { rerender, unmount } = renderHook(({ active }) => useWakeLock(active), { initialProps: { active: true } })
    await act(async () => { await Promise.resolve() })
    expect(request).toHaveBeenCalledWith('screen')

    rerender({ active: false })
    expect(release).toHaveBeenCalled()

    unmount()
    Reflect.deleteProperty(navigator, 'wakeLock')
  })

  it('releases a sentinel that resolves after the effect was already cleaned up, instead of leaking it', async () => {
    let resolveRequest: ((sentinel: { release: () => Promise<void> }) => void) | undefined
    const pending = new Promise<{ release: () => Promise<void> }>((resolve) => { resolveRequest = resolve })
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockReturnValue(pending)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })

    const { unmount } = renderHook(() => useWakeLock(true))
    // Cleanup runs (e.g. the lease was taken and immediately lost) before the
    // pending wakeLock.request() promise has settled.
    unmount()

    await act(async () => {
      resolveRequest?.({ release })
      await pending
    })

    expect(release).toHaveBeenCalled()
    Reflect.deleteProperty(navigator, 'wakeLock')
  })
})
