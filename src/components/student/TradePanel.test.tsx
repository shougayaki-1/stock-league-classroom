import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TradePanel } from './TradePanel'

describe('TradePanel', () => {
  it('現在価格と銘柄名を表示する', () => {
    render(<TradePanel stockName="開成テック" currentPrice={1500} onSubmitOrder={vi.fn()} latestResult={null} cash={100000} holding={100} />)
    expect(screen.getByText('開成テック')).toBeInTheDocument()
    expect(screen.getByText('1500')).toBeInTheDocument()
  })

  it('数量を入力して購入ボタンを押すと確認を経てonSubmitOrderが呼ばれる', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel stockName="開成テック" currentPrice={1500} onSubmitOrder={onSubmitOrder} latestResult={null} cash={100000} holding={100} />)
    await userEvent.type(screen.getByLabelText(/数量/), '5')
    await userEvent.click(screen.getByRole('button', { name: /購入/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この内容で注文する' }))
    expect(onSubmitOrder).toHaveBeenCalledWith('BUY', 5)
  })

  it('約定結果が渡されると価格変更込みのメッセージを表示する', () => {
    render(
      <TradePanel
        stockName="開成テック"
        currentPrice={1500}
        onSubmitOrder={vi.fn()}
        latestResult={{ orderId: 'o1', participantId: 'p1', teamId: 'red', stockId: 's1', side: 'BUY', requestedQuantity: 5, filledQuantity: 3, price: 1550, processedAtMillis: 0 }}
        cash={100000}
        holding={100}
      />
    )
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
        cash={100000}
        holding={100}
      />
    )
    expect(screen.getByText(/約定できませんでした/)).toBeInTheDocument()
  })
})

describe('order safety', () => {
  const base = { stockName: 'アクメ (ACME)', currentPrice: 100, latestResult: null, cash: 550, holding: 3 }

  it('shows how many shares are affordable and how many are held', () => {
    render(<TradePanel {...base} onSubmitOrder={vi.fn()} />)
    expect(screen.getByText('買える数 5株')).toBeInTheDocument()
    expect(screen.getByText('売れる数 3株')).toBeInTheDocument()
  })

  it('requires a confirmation before sending a buy order', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '4')
    await userEvent.click(screen.getByRole('button', { name: '購入' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.getByText('アクメ (ACME) を 4株、約 400円で購入します。よろしいですか？')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'この内容で注文する' }))
    expect(onSubmitOrder).toHaveBeenCalledWith('BUY', 4)
  })

  it('lets the student cancel before the order is sent', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '2')
    await userEvent.click(screen.getByRole('button', { name: '売却' }))
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.queryByText(/よろしいですか/)).not.toBeInTheDocument()
  })

  it('refuses a quantity beyond the affordable amount', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '9')
    await userEvent.click(screen.getByRole('button', { name: '購入' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('いまの現金では5株までです。')
  })

  it('refuses selling more than the team holds', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '5')
    await userEvent.click(screen.getByRole('button', { name: '売却' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('持っているのは3株です。')
  })

  it('reports that an order is in flight', () => {
    render(<TradePanel {...base} onSubmitOrder={vi.fn()} pending />)
    expect(screen.getByText('注文を送信中…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '購入' })).toBeDisabled()
  })
})
