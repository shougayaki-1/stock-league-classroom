import { useState } from 'react'
import type { OrderResult } from '../../lib/market/liveMarketTypes'
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { StudentField } from '../ui/StudentUi'
import { studentPrimaryActionSx } from '../ui/studentUiStyles'

interface TradePanelProps {
  stockName: string
  currentPrice: number
  onSubmitOrder: (side: 'BUY' | 'SELL', quantity: number) => void
  latestResult: OrderResult | null
  /** Team cash and holdings, so a mistyped digit is caught before it is sent. */
  cash: number
  holding: number
  disabled?: boolean
  pending?: boolean
}

export function TradePanel({ stockName, currentPrice, onSubmitOrder, latestResult, cash, holding, disabled = false, pending = false }: TradePanelProps) {
  const [quantity, setQuantity] = useState<number | string>('')
  const [confirming, setConfirming] = useState<'BUY' | 'SELL' | null>(null)
  const [error, setError] = useState('')
  const affordable = currentPrice > 0 ? Math.floor(cash / currentPrice) : 0
  const requested = Math.floor(Number(quantity))

  const review = (side: 'BUY' | 'SELL') => {
    setConfirming(null)
    if (quantity !== '' && !Number.isInteger(Number(quantity))) return setError('数量は整数で入力してください。')
    if (!Number.isInteger(requested) || requested < 1) return setError('数量を1株以上の整数で入力してください。')
    if (side === 'BUY' && requested > affordable) return setError(`いまの現金では${affordable}株までです。`)
    if (side === 'SELL' && requested > holding) return setError(`持っているのは${holding}株です。`)
    setError('')
    setConfirming(side)
  }
  const send = () => {
    if (!confirming) return
    onSubmitOrder(confirming, requested)
    setConfirming(null)
    setQuantity('')
  }

  return (
    <Stack spacing={2.25} sx={{ mt: 2.5 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
        <Typography component="h3" variant="h6" sx={{ fontWeight: 700 }}>{stockName}</Typography>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>¥{currentPrice.toLocaleString()}</Typography>
      </Stack>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Chip label={`買える数 ${affordable}株`} sx={{ bgcolor: 'action.hover' }} />
        <Chip label={`売れる数 ${holding}株`} sx={{ bgcolor: 'action.hover' }} />
      </Stack>

      <StudentField
        id="quantity"
        label="数量"
        type="number"
        value={quantity}
        onChange={(event) => { setQuantity(event.target.value); setConfirming(null); setError('') }}
        inputMode="numeric"
        min={1}
        max={100000}
        step={1}
        helperText="1〜100,000株の整数で入力してください。"
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Button fullWidth size="large" color="success" variant="contained" type="button" disabled={disabled || pending} onClick={() => review('BUY')}>購入</Button>
        <Button fullWidth size="large" color="error" variant="outlined" type="button" disabled={disabled || pending} onClick={() => review('SELL')}>売却</Button>
      </Stack>

      {error && <Alert severity="error" role="alert">{error}</Alert>}
      {pending && <Alert severity="info" role="status">注文を送信中…</Alert>}

      {confirming && (
        <Paper variant="outlined" role="group" aria-label="注文の確認" sx={{ p: 2.5, bgcolor: 'background.default' }}>
          <Stack spacing={1.5}>
            <Typography>{stockName} を {requested}株、約 {(requested * currentPrice).toLocaleString()}円で{confirming === 'BUY' ? '購入' : '売却'}します。よろしいですか？</Typography>
            <Typography variant="body2" color="text.secondary">価格は毎秒動きます。実際の約定価格は少し変わることがあります。</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" type="button" disabled={disabled || pending} onClick={send} sx={studentPrimaryActionSx}>この内容で注文する</Button>
              <Button variant="text" type="button" onClick={() => setConfirming(null)}>やめる</Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {!confirming && latestResult && latestResult.filledQuantity > 0 && latestResult.filledQuantity < latestResult.requestedQuantity && (
        <Alert severity="success" role="status">{latestResult.requestedQuantity}株のうち{latestResult.filledQuantity}株が{latestResult.price}円で約定しました。</Alert>
      )}
      {!confirming && latestResult && latestResult.filledQuantity === latestResult.requestedQuantity && latestResult.filledQuantity > 0 && (
        <Alert severity="success" role="status">{latestResult.filledQuantity}株を{latestResult.price}円で約定しました。</Alert>
      )}
      {!confirming && latestResult && latestResult.filledQuantity === 0 && (
        <Alert severity="error" role="status">約定できませんでした。現金か保有株が足りません。</Alert>
      )}
      {disabled && !pending && <Box><Typography variant="body2" color="text.secondary">市場が取引中のときだけ注文できます。</Typography></Box>}
    </Stack>
  )
}
