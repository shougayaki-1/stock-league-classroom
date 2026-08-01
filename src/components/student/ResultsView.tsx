import type { OrderResult } from '../../lib/market/liveMarketTypes'

export interface PositionSummary { stockId: string; bought: number; sold: number; spent: number; received: number }

interface ResultsViewProps {
  teamName: string
  finalValuation: number
  rank: number | null
  transactions: OrderResult[]
  companyNames?: Record<string, string>
  holdings?: Record<string, number>
  prices?: Record<string, number>
  onLeave?: () => void
}

/** Per-stock cash in and out, so a student can see which decision paid off. */
export const summarizePositions = (transactions: OrderResult[]): PositionSummary[] => {
  const byStock = new Map<string, PositionSummary>()
  for (const transaction of transactions) {
    const entry = byStock.get(transaction.stockId) ?? { stockId: transaction.stockId, bought: 0, sold: 0, spent: 0, received: 0 }
    const amount = transaction.filledQuantity * transaction.price
    if (transaction.side === 'BUY') { entry.bought += transaction.filledQuantity; entry.spent += amount }
    else { entry.sold += transaction.filledQuantity; entry.received += amount }
    byStock.set(transaction.stockId, entry)
  }
  return [...byStock.values()]
}

export function ResultsView({ teamName, finalValuation, rank, transactions, companyNames = {}, holdings = {}, prices = {}, onLeave }: ResultsViewProps) {
  const positions = summarizePositions(transactions)
  const nameOf = (stockId: string) => companyNames[stockId] ?? stockId
  return <main className="student-page"><section className="student-card results-card">
    <p className="portal-eyebrow">MARKET RESULT</p><h1>{teamName}の結果</h1>
    <p className="result-value">{finalValuation.toLocaleString('ja-JP')}円</p>
    {rank !== null && <p className="result-rank">{rank}位</p>}

    <h2>銘柄ごとの結果</h2>
    {positions.length ? <table className="results-positions">
      <thead><tr><th scope="col">銘柄</th><th scope="col">残っている株</th><th scope="col">買った金額</th><th scope="col">売った金額</th><th scope="col">損益</th></tr></thead>
      <tbody>{positions.map((position) => {
        const remaining = holdings[position.stockId] ?? 0
        const net = position.received + remaining * (prices[position.stockId] ?? 0) - position.spent
        return <tr key={position.stockId}>
          <th scope="row">{nameOf(position.stockId)}</th>
          <td>{remaining}株</td>
          <td>{position.spent.toLocaleString()}円</td>
          <td>{position.received.toLocaleString()}円</td>
          <td className={net >= 0 ? 'up' : 'down'}>{net >= 0 ? '+' : ''}{net.toLocaleString()}円</td>
        </tr>
      })}</tbody>
    </table> : <p>取引はありませんでした。</p>}

    <h2>あなたの取引履歴</h2>
    {transactions.length ? <ul>{[...transactions].sort((a, b) => a.processedAtMillis - b.processedAtMillis).map((tx) => <li key={tx.orderId}>{nameOf(tx.stockId)} {tx.side === 'BUY' ? '購入' : '売却'} {tx.filledQuantity}株 @ {tx.price.toLocaleString()}円</li>)}</ul> : <p>取引履歴はありません。</p>}

    <div className="results-actions">
      <a className="portal-button" href="/">トップへ戻る</a>
      <a className="outline-button" href="/join" onClick={() => onLeave?.()}>別の市場に参加する</a>
    </div>
  </section></main>
}
