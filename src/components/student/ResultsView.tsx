interface Transaction {
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
}

interface ResultsViewProps {
  finalValuation: number
  rank: number | null
  transactions: Transaction[]
}

export function ResultsView({ finalValuation, rank, transactions }: ResultsViewProps) {
  const formattedValuation = finalValuation.toLocaleString('ja-JP')

  return (
    <div>
      <p>{formattedValuation}円</p>
      {rank !== null && <p>{rank}位</p>}
      <ul>
        {transactions.map((tx, index) => (
          <li key={index}>
            {tx.stockId} {tx.side} {tx.quantity} @ {tx.price}
          </li>
        ))}
      </ul>
    </div>
  )
}
