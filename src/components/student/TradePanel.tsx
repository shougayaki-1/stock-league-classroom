import { useState } from 'react'
import type { OrderResult } from '../../lib/market/liveMarketTypes'

interface TradePanelProps {
  stockName: string
  currentPrice: number
  onSubmitOrder: (side: 'BUY' | 'SELL', quantity: number) => void
  latestResult: OrderResult | null
  /** Team cash and holdings, so a mistyped digit is caught before it is sent. */
  cash: number
  holding: number
  disabled?: boolean
  pending?: boolean
}

export function TradePanel({ stockName, currentPrice, onSubmitOrder, latestResult, cash, holding, disabled = false, pending = false }: TradePanelProps) {
  const [quantity, setQuantity] = useState<number | string>('')
  const [confirming, setConfirming] = useState<'BUY' | 'SELL' | null>(null)
  const [error, setError] = useState('')
  const affordable = currentPrice > 0 ? Math.floor(cash / currentPrice) : 0
  const requested = Math.floor(Number(quantity))

  const review = (side: 'BUY' | 'SELL') => {
    setConfirming(null)
    if (!Number.isInteger(requested) || requested < 1) return setError('数量を1株以上の整数で入力してください。')
    if (side === 'BUY' && requested > affordable) return setError(`いまの現金では${affordable}株までです。`)
    if (side === 'SELL' && requested > holding) return setError(`持っているのは${holding}株です。`)
    setError('')
    setConfirming(side)
  }
  const send = () => {
    if (!confirming) return
    onSubmitOrder(confirming, requested)
    setConfirming(null)
    setQuantity('')
  }

  return (
    <div className="trade-panel">
      <div className="trade-head">
        <span>{stockName}</span>
        <span className="trade-price">{currentPrice}</span>
      </div>

      <div className="trade-limits">
        <span>買える数 {affordable}株</span>
        <span>売れる数 {holding}株</span>
      </div>

      <div>
        <label htmlFor="quantity">数量</label>
        <input
          id="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          step={1}
          value={quantity}
          onChange={(event) => { setQuantity(event.target.value); setConfirming(null); setError('') }}
        />
      </div>

      <div className="trade-actions">
        <button type="button" disabled={disabled || pending} onClick={() => review('BUY')}>購入</button>
        <button type="button" disabled={disabled || pending} onClick={() => review('SELL')}>売却</button>
      </div>

      {error && <p className="student-message error" role="alert">{error}</p>}
      {pending && <p className="student-message" role="status">注文を送信中…</p>}

      {confirming && (
        <div className="trade-confirm" role="dialog" aria-label="注文の確認">
          <p>{stockName} を {requested}株、約 {(requested * currentPrice).toLocaleString()}円で{confirming === 'BUY' ? '購入' : '売却'}します。よろしいですか？</p>
          <p className="trade-note">価格は毎秒動きます。実際の約定価格は少し変わることがあります。</p>
          <button type="button" onClick={send}>この内容で注文する</button>
          <button type="button" className="outline-button" onClick={() => setConfirming(null)}>やめる</button>
        </div>
      )}

      {latestResult && latestResult.filledQuantity > 0 && latestResult.filledQuantity < latestResult.requestedQuantity && (
        <p className="student-message" role="status">{latestResult.requestedQuantity}株のうち{latestResult.filledQuantity}株が{latestResult.price}円で約定しました。</p>
      )}
      {latestResult && latestResult.filledQuantity === latestResult.requestedQuantity && latestResult.filledQuantity > 0 && (
        <p className="student-message" role="status">{latestResult.filledQuantity}株を{latestResult.price}円で約定しました。</p>
      )}
      {latestResult && latestResult.filledQuantity === 0 && (
        <p className="student-message error" role="status">約定できませんでした。現金か保有株が足りません。</p>
      )}
    </div>
  )
}
