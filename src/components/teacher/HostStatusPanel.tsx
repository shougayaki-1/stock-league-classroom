export interface HostStatusPanelProps {
  prices: { stockId: string; name: string; symbol: string; price: number; basePrice: number }[]
  lastTickAtMillis?: number
  hostingSinceMillis?: number
  nowMillis: number
}

/** Anything beyond a few ticks means the host loop is not running. */
const STALE_TICK_MS = 10_000

const changeLabel = (price: number, basePrice: number) => {
  const percent = basePrice > 0 ? ((price - basePrice) / basePrice) * 100 : 0
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

export function HostStatusPanel({ prices, lastTickAtMillis, hostingSinceMillis, nowMillis }: HostStatusPanelProps) {
  const hasTicked = lastTickAtMillis !== undefined
  const staleFor = hasTicked ? nowMillis - lastTickAtMillis : hostingSinceMillis === undefined ? 0 : nowMillis - hostingSinceMillis
  const isStale = hostingSinceMillis !== undefined && staleFor > STALE_TICK_MS
  return (
    <section className="host-status-panel">
      {isStale && (hasTicked
        ? <p className="form-notice stopped" role="alert">価格が{Math.floor(staleFor / 1000)}秒間更新されていません。ホスト権限が失効しているか、通信が切れています。</p>
        : <p className="form-notice stopped" role="alert">ホスト取得から{Math.floor(staleFor / 1000)}秒経っても価格が一度も更新されていません。権限が不足しているか、別の端末がホストになっている可能性があります。</p>)}
      <table className="host-price-table">
        <caption className="visually-hidden">現在の株価</caption>
        <thead><tr><th scope="col">銘柄</th><th scope="col">現在価格</th><th scope="col">開始価格</th><th scope="col">変化率</th></tr></thead>
        <tbody>{prices.map((entry) => (
          <tr key={entry.stockId}>
            <th scope="row">{entry.name} <small>{entry.symbol}</small></th>
            <td>{entry.price}</td>
            <td>{entry.basePrice}</td>
            <td className={entry.price >= entry.basePrice ? 'up' : 'down'}>{changeLabel(entry.price, entry.basePrice)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  )
}
