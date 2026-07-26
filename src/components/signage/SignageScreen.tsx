import { QRCodeSVG } from 'qrcode.react'
import type { SignageData } from '../../lib/market/liveMarketTypes'

interface SignageScreenProps {
  data: SignageData
  joinUrl: string
}

export function SignageScreen({ data, joinUrl }: SignageScreenProps) {
  return (
    <main className="signage-page">
      <header className="signage-header"><div><p>STOCK LEAGUE CLASSROOM</p><h1>教室マーケット</h1></div><div className="signage-phase">{data.phase}</div></header>
      <div className="signage-grid">
      <section className="signage-join">
        <QRCodeSVG value={joinUrl} />
        <p>参加コード</p><strong className="signage-code">{data.joinCode}</strong>
      </section>
      <section>
        <h2>現在価格</h2>
        {data.prices.length ? <ul className="signage-prices">
          {data.prices.map((p) => <li key={p.stockId}><span>{p.stockName}</span><strong>¥{p.price.toLocaleString()}</strong></li>)}
        </ul> : <p>価格は公開されていません。</p>}
      </section>
      <section>
        <h2>ニュース</h2>
        {data.publicNews.length ? <ul>{data.publicNews.map((news, idx) => <li key={idx}>{news}</li>)}</ul> : <p>公開ニュースはありません。</p>}
      </section>
      <section>
        <h2>チーム順位</h2>
        {data.leaderboard.length ? <ol className="signage-leaderboard">{data.leaderboard.map((entry) => <li key={entry.name}><span>{entry.rank}位 {entry.name}</span><strong>¥{entry.valuation.toLocaleString()}</strong></li>)}</ol> : <p>順位はまだありません。</p>}
      </section>
      </div>
    </main>
  )
}
