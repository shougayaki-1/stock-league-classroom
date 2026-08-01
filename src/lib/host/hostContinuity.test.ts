import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeInterruption, useDocumentHidden } from './hostContinuity'

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => { setHidden(false); vi.restoreAllMocks() })

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
