import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickPractice } from './QuickPractice'

describe('QuickPractice', () => {
  it('is clearly labeled as practice-only and never saved (§Task12 ブリーフ Step2)', () => {
    render(<QuickPractice />)
    expect(screen.getByText(/練習用/)).toBeInTheDocument()
    expect(screen.getByText(/保存されません/)).toBeInTheDocument()
  })

  it('never calls any network API — practice state is purely local (no saveResponseDraft wiring exists on this component)', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('must not call fetch')
    })
    render(<QuickPractice />)
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('lets the student pick an option and shows the selection state (icon/text, not color alone)', async () => {
    const user = userEvent.setup()
    render(<QuickPractice />)
    const optionA = screen.getByRole('button', { name: 'A' })
    await user.click(optionA)
    expect(optionA).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/選択しました/)).toBeInTheDocument()
  })

  describe('countdown behavior (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('counts down from 30 seconds and announces completion when time is up', () => {
      render(<QuickPractice />)
      expect(screen.getByText(/残り\s*30\s*秒/)).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(screen.getByText(/練習が終了しました/)).toBeInTheDocument()
    })

    it('exposes a screen-reader status region that announces completion', () => {
      render(<QuickPractice />)
      const status = screen.getByRole('status')
      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(status).toHaveTextContent(/練習が終了しました/)
    })

    it('calls onFinished once when the countdown reaches zero', () => {
      const onFinished = vi.fn()
      render(<QuickPractice onFinished={onFinished} />)
      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(onFinished).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps every operable control at least 44px tall (§23.5 十分大きな操作領域)', () => {
    render(<QuickPractice />)
    const optionA = screen.getByRole('button', { name: 'A' })
    const height = Number.parseFloat(getComputedStyle(optionA).minHeight)
    expect(height).toBeGreaterThanOrEqual(44)
  })
})
