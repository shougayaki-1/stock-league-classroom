import { QRCodeSVG } from 'qrcode.react'
import type { SignageData } from '../../lib/market/liveMarketTypes'
import { describeStudentPhase } from '../../lib/market/marketStatusLabels'
import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material'

interface SignageScreenProps {
  data: SignageData
  joinUrl: string
}

export function SignageScreen({ data, joinUrl }: SignageScreenProps) {
  return (
    <Box component="main" sx={{ minHeight: '100svh', p: { xs: 2, md: 4 }, bgcolor: 'background.default' }}>
      <Stack component="header" direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Box><Typography variant="overline" color="primary.main">STOCK LEAGUE CLASSROOM</Typography><Typography variant="h1">教室マーケット</Typography></Box><Chip color={data.phase === 'OPEN' ? 'success' : data.phase === 'PAUSED' ? 'warning' : 'default'} label={describeStudentPhase(data.phase)} sx={{ fontWeight: 700 }} /></Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
      <Card component="section"><CardContent><Stack spacing={1.5} sx={{ alignItems: 'center' }}><Box sx={{ bgcolor: 'background.paper', p: 1, lineHeight: 0 }}><QRCodeSVG value={joinUrl} /></Box><Typography color="text.secondary">参加コード</Typography><Typography variant="h2" sx={{ letterSpacing: '.16em', fontVariantNumeric: 'tabular-nums' }}>{data.joinCode}</Typography></Stack></CardContent></Card>
      <Card component="section"><CardContent><Typography variant="h2">現在価格</Typography>{data.prices.length ? <Stack component="ul" divider={<Divider flexItem />} sx={{ listStyle: 'none', px: 0, mb: 0 }}>{data.prices.map((p) => <Stack component="li" direction="row" key={p.stockId} sx={{ py: 1.25, justifyContent: 'space-between' }}><Typography>{p.stockName}</Typography><Typography sx={{ fontWeight: 700 }}>¥{p.price.toLocaleString()}</Typography></Stack>)}</Stack> : <Typography color="text.secondary" sx={{ mt: 2 }}>価格は公開されていません。</Typography>}</CardContent></Card>
      <Card component="section"><CardContent><Typography variant="h2">ニュース</Typography>{data.publicNews.length ? <Stack component="ul" spacing={1.25} sx={{ mt: 2, mb: 0 }}>{data.publicNews.map((news, idx) => <Typography component="li" key={idx}>{news}</Typography>)}</Stack> : <Typography color="text.secondary" sx={{ mt: 2 }}>公開ニュースはありません。</Typography>}</CardContent></Card>
      <Card component="section"><CardContent><Typography variant="h2">チーム順位</Typography>{data.leaderboard.length ? <Stack component="ol" divider={<Divider flexItem />} sx={{ mt: 1, mb: 0, pl: 3 }}>{data.leaderboard.map((entry) => <Stack component="li" direction="row" key={entry.name} sx={{ py: 1.25, justifyContent: 'space-between' }}><Typography>{entry.rank}位 {entry.name}</Typography><Typography sx={{ fontWeight: 700 }}>¥{entry.valuation.toLocaleString()}</Typography></Stack>)}</Stack> : <Typography color="text.secondary" sx={{ mt: 2 }}>順位はまだありません。</Typography>}</CardContent></Card>
      </Box>
    </Box>
  )
}
