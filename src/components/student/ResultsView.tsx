import type { OrderResult } from '../../lib/market/liveMarketTypes'
import { Box, Button, Card, CardContent, Chip, Container, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { studentPrimaryActionSx } from '../ui/studentUiStyles'

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
  return <Box component="main" sx={{ minHeight: '100svh', py: { xs: 3, md: 6 } }}><Container maxWidth="md"><Card component="section"><CardContent sx={{ p: { xs: 2, sm: 4 } }}>
    <Typography variant="overline" color="primary.main">MARKET RESULT</Typography><Typography variant="h1">{teamName}の結果</Typography>
    <Stack direction="row" spacing={2} sx={{ my: 3, alignItems: 'center' }}><Typography variant="h2" sx={{ fontSize: { xs: '2.25rem', sm: '3rem' }, fontVariantNumeric: 'tabular-nums' }}>¥{finalValuation.toLocaleString('ja-JP')}</Typography>{rank !== null && <Chip color="primary" label={`${rank}位`} />}</Stack>
    <Typography variant="h2" sx={{ mt: 4 }}>銘柄ごとの結果</Typography>
    <Typography color="text.secondary" sx={{ mt: 1 }}>チームでお金と株をひとつにまとめて取引しているので、この結果にはチームメイトの分も入っています。</Typography>
    {positions.length ? <TableContainer sx={{ mt: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}><Table size="small" aria-label="銘柄ごとの結果"><TableHead><TableRow><TableCell>銘柄</TableCell><TableCell>チームの残り株数</TableCell><TableCell>あなたが買った金額</TableCell><TableCell>あなたが売った金額</TableCell><TableCell>チーム全体の損益</TableCell></TableRow></TableHead>
      <TableBody>{positions.map((position) => {
        const remaining = holdings[position.stockId] ?? 0
        const net = position.received + remaining * (prices[position.stockId] ?? 0) - position.spent
        return <TableRow key={position.stockId}><TableCell component="th" scope="row">{nameOf(position.stockId)}</TableCell><TableCell>{remaining}株</TableCell><TableCell>{position.spent.toLocaleString()}円</TableCell><TableCell>{position.received.toLocaleString()}円</TableCell><TableCell sx={{ color: net >= 0 ? 'success.main' : 'error.main', fontWeight: 700 }}>{net >= 0 ? '+' : ''}{net.toLocaleString()}円</TableCell></TableRow>
      })}</TableBody>
    </Table></TableContainer> : <Typography sx={{ mt: 2 }}>取引はありませんでした。</Typography>}

    <Typography variant="h2" sx={{ mt: 4 }}>あなたの取引履歴</Typography>
    {transactions.length ? <Stack component="ul" spacing={1} sx={{ pl: 3, mt: 1 }}>{[...transactions].sort((a, b) => a.processedAtMillis - b.processedAtMillis).map((tx) => <Typography component="li" key={tx.orderId}>{nameOf(tx.stockId)} {tx.side === 'BUY' ? '購入' : '売却'} {tx.filledQuantity}株 @ {tx.price.toLocaleString()}円</Typography>)}</Stack> : <Typography sx={{ mt: 1 }}>取引履歴はありません。</Typography>}

    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4 }}><Button href="/" variant="contained" sx={studentPrimaryActionSx}>トップへ戻る</Button><Button href="/join" color="inherit" variant="outlined" onClick={() => onLeave?.()}>別の市場に参加する</Button></Stack>
  </CardContent></Card></Container></Box>
}
