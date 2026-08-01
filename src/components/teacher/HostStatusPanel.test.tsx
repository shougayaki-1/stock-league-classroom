import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HostStatusPanel, describeElapsed } from './HostStatusPanel'

describe('describeElapsed', () => {
  it('counts from the market opening in minutes and seconds', () => {
    expect(describeElapsed(undefined, 1_000)).toBe('未開始')
    expect(describeElapsed(0, 5_000)).toBe('0分05秒')
    expect(describeElapsed(0, 125_000)).toBe('2分05秒')
  })
})

describe('HostStatusPanel', () => {
  const props = {
    status: 'OPEN' as const,
    openedAtMillis: 0,
    nowMillis: 90_000,
    participantCount: 12,
    capacity: 80,
    pendingOrderCount: 3,
    prices: [{ stockId: 'acme', name: 'アクメ', symbol: 'ACME', price: 512, basePrice: 500 }],
    lastTickAtMillis: 89_000,
  }

  it('shows the elapsed time, participants and unprocessed orders', () => {
    render(<HostStatusPanel {...props} />)
    expect(screen.getByText('1分30秒')).toBeInTheDocument()
    expect(screen.getByText('12 / 80')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows each price with its change against the starting price', () => {
    render(<HostStatusPanel {...props} />)
    expect(screen.getByText('512')).toBeInTheDocument()
    expect(screen.getByText('+2.4%')).toBeInTheDocument()
  })

  it('warns when the last tick is stale', () => {
    render(<HostStatusPanel {...props} lastTickAtMillis={60_000} />)
    expect(screen.getByRole('alert')).toHaveTextContent('30秒間更新されていません')
  })
})
