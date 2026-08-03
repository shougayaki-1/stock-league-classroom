import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { describeElapsed, PhaseBand } from './PhaseBand'

describe('describeElapsed', () => {
  it('counts from the market opening in minutes and seconds', () => {
    expect(describeElapsed(undefined, 1_000)).toBe('未開始')
    expect(describeElapsed(0, 5_000)).toBe('0分05秒')
    expect(describeElapsed(0, 125_000)).toBe('2分05秒')
  })
})

describe('PhaseBand', () => {
  it('highlights the current phase and shows elapsed time, participants and unprocessed orders', () => {
    render(<PhaseBand status="OPEN" openedAtMillis={0} nowMillis={90_000} participantCount={12} capacity={80} pendingOrderCount={3} />)
    expect(screen.getByText('取引中')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('準備中')).not.toHaveAttribute('aria-current')
    expect(screen.getByText('1分30秒')).toBeInTheDocument()
    expect(screen.getByText('12 / 80')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('highlights setup when the market has not opened yet', () => {
    render(<PhaseBand status="SETUP" nowMillis={1_000} participantCount={0} capacity={80} pendingOrderCount={0} />)
    expect(screen.getByText('準備中')).toHaveAttribute('aria-current', 'step')
  })
})
