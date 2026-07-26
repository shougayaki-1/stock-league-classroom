import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultsView } from './ResultsView'
import type { OrderResult } from '../../lib/market/liveMarketTypes'

const transaction = (orderId: string, side: 'BUY' | 'SELL' = 'BUY'): OrderResult => ({
  orderId, participantId: 'p1', teamId: 'red', stockId: 's1', side,
  requestedQuantity: 5, filledQuantity: 5, price: 1000, processedAtMillis: 1,
})

describe('ResultsView', () => {
  it('チームの最終評価額と順位を表示する', () => {
    render(<ResultsView teamName="赤チーム" finalValuation={1_250_000} rank={3} transactions={[transaction('a')]} />)
    expect(screen.getByText(/1,250,000/)).toBeInTheDocument()
    expect(screen.getByText(/3位/)).toBeInTheDocument()
    expect(screen.getByText(/赤チーム/)).toBeInTheDocument()
  })

  it('順位がnullの場合は順位を表示しない', () => {
    render(<ResultsView teamName="赤チーム" finalValuation={1_250_000} rank={null} transactions={[]} />)
    expect(screen.queryByText(/位/)).not.toBeInTheDocument()
  })

  it('本人の取引履歴を表示する', () => {
    render(<ResultsView teamName="赤チーム" finalValuation={1_000_000} rank={null} transactions={[transaction('a'), transaction('b', 'SELL')]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
