import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TradePanel } from './TradePanel'

describe('TradePanel', () => {
  it('現在価格と銘柄名を表示する', () => {
    render(<TradePanel stockName="開成テック" currentPrice={1500} onSubmitOrder={vi.fn()} latestResult={null} />)
    expect(screen.getByText('開成テック')).toBeInTheDocument()
    expect(screen.getByText('1500')).toBeInTheDocument()
  })

  it('数量を入力して購入ボタンを押すとonSubmitOrderが呼ばれる', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel stockName="開成テック" currentPrice={1500} onSubmitOrder={onSubmitOrder} latestResult={null} />)
    await userEvent.type(screen.getByLabelText(/数量/), '5')
    await userEvent.click(screen.getByRole('button', { name: /購入/ }))
    expect(onSubmitOrder).toHaveBeenCalledWith('BUY', 5)
  })

  it('約定結果が渡されると価格変更込みのメッセージを表示する', () => {
    render(
      <TradePanel
        stockName="開成テック"
        currentPrice={1500}
        onSubmitOrder={vi.fn()}
        latestResult={{ orderId: 'o1', participantId: 'p1', teamId: 'red', stockId: 's1', side: 'BUY', requestedQuantity: 5, filledQuantity: 3, price: 1550, processedAtMillis: 0 }}
      />
    )
    expect(screen.getByText(/価格が変更されたため/)).toBeInTheDocument()
    expect(screen.getByText(/3株/)).toBeInTheDocument()
    expect(screen.getByText(/1550円/)).toBeInTheDocument()
  })

  it('約定株数が0の場合は約定できなかった旨を表示する', () => {
    render(
      <TradePanel
        stockName="開成テック"
        currentPrice={1500}
        onSubmitOrder={vi.fn()}
        latestResult={{ orderId: 'o2', participantId: 'p1', teamId: 'red', stockId: 's1', side: 'BUY', requestedQuantity: 5, filledQuantity: 0, price: 1550, processedAtMillis: 0 }}
      />
    )
    expect(screen.getByText(/約定できませんでした/)).toBeInTheDocument()
  })
})
