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
  hostingSinceMillis?: number
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

export function HostStatusPanel({ status, openedAtMillis, nowMillis, participantCount, capacity, pendingOrderCount, prices, lastTickAtMillis, hostingSinceMillis }: HostStatusPanelProps) {
  const hasTicked = lastTickAtMillis !== undefined
  const staleFor = hasTicked ? nowMillis - lastTickAtMillis : hostingSinceMillis === undefined ? 0 : nowMillis - hostingSinceMillis
  const isStale = hostingSinceMillis !== undefined && staleFor > STALE_TICK_MS
  const systemPhase = status === 'OPEN' ? 'RUNNING' : status === 'ENDED' ? 'ENDED' : status === 'ENDING' ? 'ENDING' : 'STOP'
  return (
    <section className="host-status-panel admin-control-panel">
      <div className="admin-phase-row">
        <div className="admin-phase-title">
          <span className="admin-phase-icon" aria-hidden="true">■</span>
          <div><p className="admin-eyebrow">SYSTEM PHASE</p><strong>{systemPhase}</strong><span>{STATUS_LABEL[status]}</span></div>
        </div>
        <div className="admin-phase-actions" aria-label="市場フェーズ">
          <span className={`admin-control-pill ${systemPhase === 'STOP' ? 'selected' : ''}`}>□ <b>STOP</b></span>
          <span className={`admin-control-pill ${systemPhase === 'RUNNING' ? 'selected running' : ''}`}>▷ <b>RUNNING</b></span>
          <span className="admin-control-pill danger">⌁ <b>緊急暴落</b></span>
          <span className="admin-control-pill success">⌁ <b>緊急急騰</b></span>
        </div>
      </div>
      {isStale && (hasTicked
        ? <p className="form-notice stopped" role="alert">価格が{Math.floor(staleFor / 1000)}秒間更新されていません。ホスト権限が失効しているか、通信が切れています。</p>
        : <p className="form-notice stopped" role="alert">ホスト取得から{Math.floor(staleFor / 1000)}秒経っても価格が一度も更新されていません。権限が不足しているか、別の端末がホストになっている可能性があります。</p>)}
      <div className="admin-metric-row">
        <span>状態 <b>{STATUS_LABEL[status]}</b></span>
        <span>経過時間 <b>{describeElapsed(openedAtMillis, nowMillis)}</b></span>
        <span>参加者 <b>{participantCount} / {capacity}</b></span>
        <span>未処理の注文 <b>{pendingOrderCount}</b></span>
      </div>
      <table className="host-price-table admin-market-table">
        <caption className="visually-hidden">現在の株価</caption>
        <thead><tr><th scope="col">銘柄</th><th scope="col">現在価格</th><th scope="col">目標価格</th><th scope="col">遅延</th><th scope="col">現在フェーズ</th><th scope="col">フェーズ</th><th scope="col">操作</th></tr></thead>
        <tbody>{prices.map((entry) => (
          <tr key={entry.stockId}>
            <th scope="row">{entry.name} <small>{entry.symbol}</small></th>
            <td>{entry.price}</td>
            <td>{entry.basePrice}</td>
            <td>—</td>
            <td>{STATUS_LABEL[status]}</td>
            <td className={entry.price >= entry.basePrice ? 'up' : 'down'}>{changeLabel(entry.price, entry.basePrice)}</td>
            <td><span className="admin-row-action">詳細</span></td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  )
}
