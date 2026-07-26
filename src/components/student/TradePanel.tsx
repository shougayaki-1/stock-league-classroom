import { useState } from 'react'
import type { OrderResult } from '../../lib/market/liveMarketTypes'

interface TradePanelProps {
  stockName: string
  currentPrice: number
  onSubmitOrder: (side: 'BUY' | 'SELL', quantity: number) => void
  latestResult: OrderResult | null
  disabled?: boolean
}

export function TradePanel({ stockName, currentPrice, onSubmitOrder, latestResult, disabled = false }: TradePanelProps) {
  const [quantity, setQuantity] = useState<number | string>('')

  const handleBuy = () => {
    const qty = Number(quantity)
    if (qty > 0) {
      onSubmitOrder('BUY', qty)
    }
  }

  const handleSell = () => {
    const qty = Number(quantity)
    if (qty > 0) {
      onSubmitOrder('SELL', qty)
    }
  }

  return (
    <div>
      <div>
        <span>{stockName}</span>
        <span>{currentPrice}</span>
      </div>

      <div>
        <label htmlFor="quantity">数量</label>
        <input
          id="quantity"
          type="number"
          min={1}
          max={100000}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>

      <button disabled={disabled} onClick={handleBuy}>購入</button>
      <button disabled={disabled} onClick={handleSell}>売却</button>

      {latestResult && latestResult.filledQuantity > 0 && (
        <div>
          <p>価格が変更されたため{latestResult.filledQuantity}株{latestResult.price}円で約定しました。</p>
        </div>
      )}

      {latestResult && latestResult.filledQuantity === 0 && (
        <div>
          <p>約定できませんでした。</p>
        </div>
      )}
    </div>
  )
}
