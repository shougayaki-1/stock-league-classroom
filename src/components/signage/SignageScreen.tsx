import { QRCodeSVG } from 'qrcode.react'
import type { SignageData } from '../../lib/market/signageWriter'

interface SignageScreenProps {
  data: SignageData
  joinUrl: string
}

export function SignageScreen({ data, joinUrl }: SignageScreenProps) {
  return (
    <div>
      {/* QR Code */}
      <div>
        <QRCodeSVG value={joinUrl} />
      </div>

      {/* Prices */}
      <div>
        <h2>Stock Prices</h2>
        <ul>
          {data.prices.map((p) => (
            <li key={p.stockId}>
              <span>{p.stockName}</span>
              <span>{p.price}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Public News */}
      <div>
        <h2>News</h2>
        <ul>
          {data.publicNews.map((news, idx) => (
            <li key={idx}>{news}</li>
          ))}
        </ul>
      </div>

      {/* Phase */}
      <div>
        <h2>Phase</h2>
        <p>{data.phase}</p>
      </div>

      {/* Leaderboard */}
      <div>
        <h2>Leaderboard</h2>
        <ul>
          {data.leaderboard.map((entry, idx) => (
            <li key={idx}>
              <span>{entry.name}</span>
              <span>{entry.valuation}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
