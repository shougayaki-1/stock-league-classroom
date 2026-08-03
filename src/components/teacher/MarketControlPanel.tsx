import { Box, Button, Card, CardContent, Divider, Paper, Stack, Typography } from '@mui/material'
import type { MarketStatus } from '../../lib/market/liveMarketTypes'

export interface MarketControlPanelProps {
  lease: string
  marketStatus: MarketStatus
  endingConfirm: boolean
  ending: boolean
  onTakeLease: () => void
  onOpenMarket: () => void
  onRequestEnd: () => void
  onCancelEnd: () => void
  onConfirmEnd: () => void
}

export function MarketControlPanel({ lease, marketStatus, endingConfirm, ending, onTakeLease, onOpenMarket, onRequestEnd, onCancelEnd, onConfirmEnd }: MarketControlPanelProps) {
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">MARKET CONTROL</Typography>
          <Typography component="h2" variant="h4">{lease ? '市場を進行できます' : marketStatus === 'ENDED' ? '市場は終了しました' : 'この端末で市場を管理する'}</Typography>
          <Typography color="text.secondary">{lease ? '市場の開始・終了やニュース配信を行えます。画面を閉じるとホスト権限は自動的に解放されます。' : marketStatus === 'ENDED' ? '結果は確定しています。この画面でホストを再取得する必要はありません。' : '最初にホスト権限を取得してください。ほかの端末が操作中の場合は取得できません。'}</Typography>
          <Divider />
          {!lease
            ? (marketStatus === 'ENDED' ? null : <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={onTakeLease}>ホストを取得する</Button>)
            : <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                <Button variant="contained" onClick={onOpenMarket}>市場を開始</Button>
                {!endingConfirm
                  ? <Button variant="outlined" color="error" onClick={onRequestEnd}>市場を終了</Button>
                  : <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
                      <Stack spacing={1.5}>
                        <Typography><Box component="strong">市場を終了すると、結果が確定して元に戻せません。</Box> 生徒はこれ以上売買できなくなります。</Typography>
                        <Stack direction="row" spacing={1}>
                          <Button color="error" variant="contained" disabled={ending} onClick={onConfirmEnd}>{ending ? '処理中…' : '終了して結果を確定する'}</Button>
                          <Button variant="outlined" disabled={ending} onClick={onCancelEnd}>やめる</Button>
                        </Stack>
                      </Stack>
                    </Paper>}
              </Stack>}
        </Stack>
      </CardContent>
    </Card>
  )
}
