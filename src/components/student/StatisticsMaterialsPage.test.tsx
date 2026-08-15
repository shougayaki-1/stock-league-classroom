import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatisticsMaterialsPage } from './StatisticsMaterialsPage'
import type { EconomicIndicatorPublicView } from '@stock-league/market-public-content'

describe('StatisticsMaterialsPage', () => {
  const indicators: EconomicIndicatorPublicView[] = [
    {
      id: 'ind-1',
      kind: 'FX',
      label: '米ドル/円 相場',
      publishedAtMillis: 1700000000000,
      value: 155.2,
      changeFromPrevious: 0.8,
    },
    {
      id: 'ind-2',
      kind: 'INTEREST_RATE',
      label: '政策金利引き上げ発表',
      publishedAtMillis: 1700000010000,
    },
  ]

  it('renders empty message when there are no indicators', () => {
    render(<StatisticsMaterialsPage economicIndicators={[]} />)
    expect(screen.getByText('公開されている統計資料はありません。')).toBeInTheDocument()
  })

  it('renders indicators with kind, label, and values when present', () => {
    render(<StatisticsMaterialsPage economicIndicators={indicators} />)

    expect(screen.getByText('米ドル/円 相場')).toBeInTheDocument()
    expect(screen.getByText('155.2')).toBeInTheDocument()
    expect(screen.getByText('+0.8')).toBeInTheDocument()

    expect(screen.getByText('政策金利引き上げ発表')).toBeInTheDocument()
    expect(screen.getByText('金利')).toBeInTheDocument()
  })
})
