import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PhaseCountdown } from './PhaseCountdown'

afterEach(() => { vi.useRealTimers() })

describe('PhaseCountdown', () => {
  it('残り時間を分と秒で表示する', () => {
    render(<PhaseCountdown endsAtMillis={1_000_000 + 125_000} now={() => 1_000_000} />)
    expect(screen.getByText('残り 2:05')).toBeInTheDocument()
  })

  it('1秒ごとに描き直す', () => {
    vi.useFakeTimers()
    let current = 1_000_000
    render(<PhaseCountdown endsAtMillis={1_000_000 + 125_000} now={() => current} />)

    expect(screen.getByText('残り 2:05')).toBeInTheDocument()
    act(() => { current = 1_003_000; vi.advanceTimersByTime(3_000) })

    expect(screen.getByText('残り 2:02')).toBeInTheDocument()
  })

  it('0以下では時間終了と表示し、負の数を出さない', () => {
    render(<PhaseCountdown endsAtMillis={1_000_000} now={() => 1_030_000} />)
    expect(screen.getByText('時間終了')).toBeInTheDocument()
  })

  it('endsAtMillis が null なら何も描かない', () => {
    const { container } = render(<PhaseCountdown endsAtMillis={null} now={() => 1_000_000} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('アンマウントでタイマーを解除する', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = render(<PhaseCountdown endsAtMillis={1_000_000 + 60_000} now={() => 1_000_000} />)

    unmount()

    expect(clearSpy).toHaveBeenCalled()
  })
})
