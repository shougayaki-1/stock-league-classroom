import type { MarketStatus } from '../../lib/market/liveMarketTypes'

export interface HostStatusPanelProps {
  status: MarketStatus
  openedAtMillis?: number
  nowMillis: number
  participantCount: number
  capacity: number
  pendingOrderCount: number
  prices: { stockId: string; name: string; symbol: string; price: number; basePrice: number }[]
  lastTickAtMillis?: number
}

const STATUS_LABEL: Record<MarketStatus, string> = { SETUP: '準備中', OPEN: '取引中', ENDING: '結果を確定中', ENDED: '終了' }
/** Anything beyond a few ticks means the host loop is not running. */
const STALE_TICK_MS = 10_000

export const describeElapsed = (openedAtMillis: number | undefined, nowMillis: number): string => {
  if (openedAtMillis === undefined) return '未開始'
  const seconds = Math.max(0, Math.floor((nowMillis - openedAtMillis) / 1000))
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`
}

const changeLabel = (price: number, basePrice: number) => {
  const percent = basePrice > 0 ? ((price - basePrice) / basePrice) * 100 : 0
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

export function HostStatusPanel({ status, openedAtMillis, nowMillis, participantCount, capacity, pendingOrderCount, prices, lastTickAtMillis }: HostStatusPanelProps) {
  const staleFor = lastTickAtMillis === undefined ? 0 : nowMillis - lastTickAtMillis
  return (
    <section className="host-status-panel">
      <p className="section-kicker">MARKET STATUS</p>
      {staleFor > STALE_TICK_MS && <p className="form-notice stopped" role="alert">価格が{Math.floor(staleFor / 1000)}秒間更新されていません。ホスト権限が失効しているか、通信が切れています。</p>}
      <div className="host-status-grid">
        <div><span>状態</span><strong>{STATUS_LABEL[status]}</strong></div>
        <div><span>経過時間</span><strong>{describeElapsed(openedAtMillis, nowMillis)}</strong></div>
        <div><span>参加者</span><strong>{participantCount} / {capacity}</strong></div>
        <div><span>未処理の注文</span><strong>{pendingOrderCount}</strong></div>
      </div>
      <table className="host-price-table">
        <caption className="visually-hidden">現在の株価</caption>
        <thead><tr><th scope="col">銘柄</th><th scope="col">現在値</th><th scope="col">開始比</th></tr></thead>
        <tbody>{prices.map((entry) => (
          <tr key={entry.stockId}>
            <th scope="row">{entry.name} <small>{entry.symbol}</small></th>
            <td>{entry.price}</td>
            <td className={entry.price >= entry.basePrice ? 'up' : 'down'}>{changeLabel(entry.price, entry.basePrice)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  )
}
