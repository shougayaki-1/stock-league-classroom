import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderScreen } from './OrderScreen'
import type { CompanyPublicView } from '@stock-league/market-public-content'
import type { LessonRunTeamState, StockPublicState } from '../../lib/lessonRuns/liveTypes'

describe('OrderScreen', () => {
  const companies: CompanyPublicView[] = [
    {
      id: 'comp-1',
      name: 'Alpha Tech',
      symbol: '1001',
      industry: 'Tech',
      description: 'Desc',
      productsAndServices: [],
      sizeClass: 'LARGE',
      riskFactors: [],
    },
    {
      id: 'comp-2',
      name: 'Beta Motors',
      symbol: '1002',
      industry: 'Auto',
      description: 'Desc',
      productsAndServices: [],
      sizeClass: 'MEDIUM',
      riskFactors: [],
    },
  ]

  const stocks: Record<string, StockPublicState> = {
    'comp-1': {
      currentPrice: 1000,
      previousPrice: 950,
      guardApplied: false,
      suddenChangeWarning: false,
      breakdown: { informationPercent: 50, demandPercent: 30, otherPercent: 20, total: 100 },
      displayedVolumeShares: 100,
    },
    'comp-2': {
      currentPrice: 2000,
      previousPrice: 2100,
      guardApplied: false,
      suddenChangeWarning: false,
      breakdown: { informationPercent: 40, demandPercent: 40, otherPercent: 20, total: 100 },
      displayedVolumeShares: 50,
    },
  }

  const teamState: LessonRunTeamState = {
    cash: 50000,
    holdings: { 'comp-1': 10, 'comp-2': 5 },
    lockedBuyValue: 10000,
    lockedSellQuantity: { 'comp-1': 2 },
    myOrders: [
      {
        orderId: 'o1',
        stockId: 'comp-1',
        side: 'BUY',
        quantity: 5,
        status: 'FILLED',
        referencePrice: 950,
        executionPrice: 980,
      },
    ],
    updatedAtMillis: 1000,
  }

  it('renders cash balance, available funds, and existing holdings', () => {
    render(
      <OrderScreen
        companies={companies}
        stocks={stocks}
        teamState={teamState}
        onSubmitOrder={vi.fn()}
      />,
    )

    expect(screen.getByText(/保有現金: 50,000 円/)).toBeInTheDocument()
    expect(screen.getByText(/利用可能現金: 40,000 円/)).toBeInTheDocument()
    expect(screen.getByText(/Alpha Tech: 10株/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '買い' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '売り' })).toBeInTheDocument()
    expect(screen.queryByText(/\(BUY\)|\(SELL\)/)).not.toBeInTheDocument()
  })

  it('fails closed for unknown order metadata and unresolved stock ids', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const opaqueStockId = 'opaque-stock-id'
    const malformedTeamState: LessonRunTeamState = {
      ...teamState,
      myOrders: [
        {
          ...teamState.myOrders[0],
          orderId: 'o-unknown',
          stockId: opaqueStockId,
          side: raw as never,
          status: raw as never,
        },
      ],
    }

    render(
      <OrderScreen
        companies={companies}
        stocks={stocks}
        teamState={malformedTeamState}
        onSubmitOrder={vi.fn()}
      />,
    )

    expect(screen.getByText('銘柄名を確認できません')).toBeInTheDocument()
    expect(screen.getByText('売買区分を確認できません')).toBeInTheDocument()
    expect(screen.getByText(/注文状態を確認できません/)).toBeInTheDocument()
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
    expect(screen.queryByText(opaqueStockId)).not.toBeInTheDocument()
  })

  it('never renders a raw backend error from order submission', async () => {
    const user = userEvent.setup()
    const raw = 'INTERNAL_BACKEND_DETAIL'
    const onSubmitOrder = vi.fn().mockRejectedValue(new Error(raw))

    render(
      <OrderScreen
        companies={companies}
        stocks={stocks}
        teamState={teamState}
        onSubmitOrder={onSubmitOrder}
      />,
    )

    await user.click(screen.getByRole('button', { name: '買い注文を出す' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '注文を送信できませんでした。もう一度お試しください。',
    )
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
  })

  it('submits a valid BUY order', async () => {
    const user = userEvent.setup()
    const onSubmitOrder = vi.fn().mockResolvedValue(undefined)

    render(
      <OrderScreen
        companies={companies}
        stocks={stocks}
        teamState={teamState}
        onSubmitOrder={onSubmitOrder}
      />,
    )

    // Select Alpha Tech, quantity 5
    const quantityInput = screen.getByLabelText('注文株数')
    await user.clear(quantityInput)
    await user.type(quantityInput, '5')

    const submitBtn = screen.getByRole('button', { name: '買い注文を出す' })
    expect(submitBtn).toBeEnabled()
    await user.click(submitBtn)

    expect(onSubmitOrder).toHaveBeenCalledWith({
      stockId: 'comp-1',
      side: 'BUY',
      quantity: 5,
    })
  })

  it('disables order button when market is paused', () => {
    render(
      <OrderScreen
        companies={companies}
        stocks={stocks}
        teamState={teamState}
        marketPaused={true}
        onSubmitOrder={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /注文を出す/ })).toBeDisabled()
    expect(screen.getByText(/市場は現在停止中です/)).toBeInTheDocument()
  })

  it('renders order history (myOrders)', () => {
    render(
      <OrderScreen
        companies={companies}
        stocks={stocks}
        teamState={teamState}
        onSubmitOrder={vi.fn()}
      />,
    )

    expect(screen.getByText('注文履歴')).toBeInTheDocument()
    expect(screen.getByText('約定済み (約定価格: 980円)')).toBeInTheDocument()
  })
})
