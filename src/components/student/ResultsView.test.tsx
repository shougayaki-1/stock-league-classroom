import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultsView } from './ResultsView'

describe('ResultsView', () => {
  it('最終評価額と順位を表示する', () => {
    render(
      <ResultsView
        finalValuation={1_250_000}
        rank={3}
        transactions={[{ stockId: 's1', side: 'BUY', quantity: 5, price: 1000 }]}
      />
    )
    expect(screen.getByText(/1,250,000/)).toBeInTheDocument()
    expect(screen.getByText(/3位/)).toBeInTheDocument()
  })

  it('順位が非公開範囲でnullの場合は順位を表示しない', () => {
    render(<ResultsView finalValuation={1_250_000} rank={null} transactions={[]} />)
    expect(screen.queryByText(/位/)).not.toBeInTheDocument()
  })

  it('取引履歴の一覧を表示する', () => {
    render(
      <ResultsView
        finalValuation={1_000_000}
        rank={null}
        transactions={[
          { stockId: 's1', side: 'BUY', quantity: 5, price: 1000 },
          { stockId: 's1', side: 'SELL', quantity: 2, price: 1100 },
        ]}
      />
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
