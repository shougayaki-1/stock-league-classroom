import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultsView, summarizePositions } from './ResultsView'
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

describe('summarizePositions', () => {
  const tx = (side: 'BUY' | 'SELL', filledQuantity: number, price: number, processedAtMillis: number) =>
    ({ orderId: `${side}${processedAtMillis}`, participantId: 'p', teamId: 't', stockId: 'acme', side, requestedQuantity: filledQuantity, filledQuantity, price, processedAtMillis })

  it('nets buys and sells into a realised amount per stock', () => {
    const [position] = summarizePositions([tx('BUY', 5, 100, 1), tx('SELL', 2, 130, 2)])
    expect(position).toEqual({ stockId: 'acme', bought: 5, sold: 2, spent: 500, received: 260 })
  })

  it('returns an empty list when nothing traded', () => {
    expect(summarizePositions([])).toEqual([])
  })
})

describe('ResultsView positions', () => {
  it('shows the company name, remaining holding and net result', () => {
    render(<ResultsView
      teamName="赤" finalValuation={8500} rank={1}
      transactions={[{ orderId: 'o1', participantId: 'p', teamId: 't', stockId: 'acme', side: 'BUY', requestedQuantity: 5, filledQuantity: 5, price: 100, processedAtMillis: 1 }]}
      companyNames={{ acme: 'アクメ' }} holdings={{ acme: 5 }} prices={{ acme: 120 }}
    />)
    expect(screen.getByText('アクメ')).toBeInTheDocument()
    expect(screen.getByText('5株')).toBeInTheDocument()
    expect(screen.getByText('+100円')).toBeInTheDocument()
    expect(screen.getByText('チームの残り株数')).toBeInTheDocument()
    expect(screen.getByText('あなたが買った金額')).toBeInTheDocument()
    expect(screen.getByText('あなたが売った金額')).toBeInTheDocument()
    expect(screen.getByText('チーム全体の損益')).toBeInTheDocument()
    expect(screen.getByText('チームでお金と株をひとつにまとめて取引しているので、この結果にはチームメイトの分も入っています。')).toBeInTheDocument()
  })
})
