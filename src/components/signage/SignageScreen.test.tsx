import { render, screen } from '@testing-library/react'
import { SignageScreen } from './SignageScreen'

describe('SignageScreen', () => {
  it('価格・ニュース・進行状態・ランキングを表示する', () => {
    render(
      <SignageScreen
        joinUrl="https://stock-league-classroom.web.app/join/ABC123"
        data={{
          prices: [{ stockId: 's1', stockName: '開成テック', price: 1500 }],
          publicNews: ['本日の市場が開場しました。'],
          phase: 'OPEN',
          leaderboard: [{ name: 'たろう', valuation: 1_200_000 }],
        }}
      />
    )
    expect(screen.getByText('開成テック')).toBeInTheDocument()
    expect(screen.getByText('1500')).toBeInTheDocument()
    expect(screen.getByText(/本日の市場が開場しました/)).toBeInTheDocument()
    expect(screen.getByText('たろう')).toBeInTheDocument()
  })
})
