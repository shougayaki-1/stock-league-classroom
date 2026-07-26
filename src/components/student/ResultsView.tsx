import type { OrderResult } from '../../lib/market/liveMarketTypes'

interface ResultsViewProps {
  teamName: string
  finalValuation: number
  rank: number | null
  transactions: OrderResult[]
}

export function ResultsView({ teamName, finalValuation, rank, transactions }: ResultsViewProps) {
  return <main className="student-page"><section className="student-card results-card">
    <p className="portal-eyebrow">MARKET RESULT</p><h1>{teamName}の結果</h1>
    <p className="result-value">{finalValuation.toLocaleString('ja-JP')}円</p>
    {rank !== null && <p className="result-rank">{rank}位</p>}
    <h2>あなたの取引履歴</h2>
    {transactions.length ? <ul>{transactions.sort((a, b) => a.processedAtMillis - b.processedAtMillis).map((tx) => <li key={tx.orderId}>{tx.stockId} {tx.side === 'BUY' ? '購入' : '売却'} {tx.filledQuantity}株 @ {tx.price.toLocaleString()}円</li>)}</ul> : <p>取引履歴はありません。</p>}
    <a className="portal-button" href="/">トップへ戻る</a>
  </section></main>
}
