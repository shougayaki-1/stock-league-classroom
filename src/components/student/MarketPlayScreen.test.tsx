import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarketPlayScreen } from './MarketPlayScreen'

const stocks = { 'stock-a': { currentPrice: 1000, previousPrice: 950, guardApplied: false, suddenChangeWarning: false, breakdown: { informationPercent: 1, demandPercent: 1, otherPercent: 1, total: 3 }, displayedVolumeShares: 10 } }
const teamState = { cash: 100000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1 }
const companies = [{ id: 'company-a', name: 'サンプル企業', stockId: 'stock-a' } as never]
const informationItems = [{ id: 'info-1', source: '日経新聞', body: '本文テスト', targetCompanyIds: [], category: 'OFFICIAL_NEWS', natureType: 'FACT', confidenceLevel: 'HIGH' } as never]

describe('MarketPlayScreen', () => {
  it('shows only the tabs listed in availablePanels', () => {
    render(
      <MarketPlayScreen
        companies={companies}
        informationItems={informationItems}
        stocks={stocks}
        teamState={teamState}
        marketPaused={false}
        availablePanels={['ORDERS']}
        onSubmitOrder={vi.fn()}
      />,
    )
    expect(screen.getByRole('tab', { name: '取引' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '企業情報' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'ニュース' })).not.toBeInTheDocument()
  })

  it('switches between tabs and renders the matching screen', () => {
    render(
      <MarketPlayScreen
        companies={companies}
        informationItems={informationItems}
        stocks={stocks}
        teamState={teamState}
        marketPaused={false}
        availablePanels={['ORDERS', 'COMPANIES', 'NEWS']}
        onSubmitOrder={vi.fn()}
      />,
    )
    expect(screen.getByText('新規注文発注')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '企業情報' }))
    expect(screen.getByText('企業概要')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'ニュース' }))
    expect(screen.getByText('本文テスト')).toBeInTheDocument()
  })

  it('passes teamState/marketPaused through to OrderScreen and forwards submitted orders', () => {
    const onSubmitOrder = vi.fn()
    render(
      <MarketPlayScreen
        companies={companies}
        informationItems={informationItems}
        stocks={stocks}
        teamState={teamState}
        marketPaused={false}
        availablePanels={['ORDERS']}
        onSubmitOrder={onSubmitOrder}
      />,
    )
    expect(screen.getAllByText(/100,000/)[0]).toBeInTheDocument()
  })
})
