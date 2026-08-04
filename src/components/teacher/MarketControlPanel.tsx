import { Box, Button, Card, CardContent, Divider, Paper, Stack, Typography } from '@mui/material'
import type { MarketStatus } from '../../lib/market/liveMarketTypes'

export interface MarketControlPanelProps {
  lease: string
  marketStatus: MarketStatus
  endingConfirm: boolean
  ending: boolean
  onTakeLease: () => void
  onPauseMarket: () => void
  onOpenMarket: () => void
  onRequestEnd: () => void
  onCancelEnd: () => void
  onConfirmEnd: () => void
}

export function MarketControlPanel({ lease, marketStatus, endingConfirm, ending, onTakeLease, onPauseMarket, onOpenMarket, onRequestEnd, onCancelEnd, onConfirmEnd }: MarketControlPanelProps) {
  const canStart = marketStatus === 'SETUP'
  const canResume = marketStatus === 'PAUSED' || marketStatus === 'ENDING' || marketStatus === 'ENDED'
  const isPaused = marketStatus === 'PAUSED'
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">MARKET CONTROL</Typography>
          <Typography component="h2" variant="h4">{lease ? '市場を進行できます' : marketStatus === 'ENDED' ? '市場は終了しています' : isPaused ? '市場は一時停止中です' : 'この端末で市場を管理する'}</Typography>
          <Typography color="text.secondary">{lease ? '市場の開始・終了やニュース配信を行えます。終了後も必要なら市場を再開できます。' : isPaused ? 'ホストを取得すると、市場を再開できます。一時停止中は「銘柄」メニューから内容を編集できます。' : canResume ? 'ホストを取得すると、市場を再開できます。チームの資産と取引履歴は保持されています。' : '最初にホスト権限を取得してください。ほかの端末が操作中の場合は取得できません。'}</Typography>
          <Divider />
          {!lease
            ? <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={onTakeLease}>ホストを取得する</Button>
            : <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}>
                {(canStart || canResume) && <Button variant="contained" onClick={onOpenMarket}>{canResume ? '市場を再開' : '市場を開始'}</Button>}
                {marketStatus === 'OPEN' && !endingConfirm && <Button variant="outlined" onClick={onPauseMarket}>市場を一時停止</Button>}
                {marketStatus === 'OPEN' && (!endingConfirm
                  ? <Button variant="outlined" color="error" onClick={onRequestEnd}>市場を終了</Button>
                  : <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
                      <Stack spacing={1.5}>
                        <Typography><Box component="strong">市場を終了すると、結果を確定します。</Box> 生徒は売買できなくなりますが、あとで市場を再開できます。</Typography>
                        <Stack direction="row" spacing={1}>
                          <Button color="error" variant="contained" disabled={ending} onClick={onConfirmEnd}>{ending ? '処理中…' : '終了して結果を確定する'}</Button>
                          <Button variant="outlined" disabled={ending} onClick={onCancelEnd}>やめる</Button>
                        </Stack>
                      </Stack>
                    </Paper>)}
              </Stack>}
        </Stack>
      </CardContent>
    </Card>
  )
}
