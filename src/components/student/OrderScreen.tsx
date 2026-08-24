import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { CompanyPublicView } from '@stock-league/market-public-content'
import type { LessonRunTeamState, StockPublicState } from '../../lib/lessonRuns/liveTypes'
import {
  formatOrderSide,
  formatOrderStatus,
} from '../../lib/presentation/marketLabels'
import { describeUserFacingError } from '../../lib/presentation/userFacingError'

export interface OrderScreenProps {
  companies: CompanyPublicView[]
  stocks: Record<string, StockPublicState>
  teamState?: LessonRunTeamState | null
  marketPaused?: boolean
  onSubmitOrder: (input: { stockId: string; side: 'BUY' | 'SELL'; quantity: number }) => Promise<void>
  disabled?: boolean
}

export function OrderScreen({
  companies,
  stocks,
  teamState,
  marketPaused = false,
  onSubmitOrder,
  disabled = false,
}: OrderScreenProps) {
  const [selectedStockId, setSelectedStockId] = useState<string>(companies[0]?.id ?? '')
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [quantityStr, setQuantityStr] = useState<string>('1')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const activeStockId = selectedStockId || (companies[0]?.id ?? '')
  const selectedStock = stocks[activeStockId]
  const selectedCompany = companies.find((c) => c.id === activeStockId)

  const currentPrice = selectedStock?.currentPrice ?? 0
  const quantity = parseInt(quantityStr, 10)
  const isValidQuantity = !isNaN(quantity) && quantity > 0
  const estimatedTotal = isValidQuantity ? quantity * currentPrice : 0

  const cash = teamState?.cash ?? 0
  const lockedBuyValue = teamState?.lockedBuyValue ?? 0
  const availableCash = Math.max(0, cash - lockedBuyValue)

  const currentHoldings = teamState?.holdings?.[activeStockId] ?? 0
  const lockedSellQty = teamState?.lockedSellQuantity?.[activeStockId] ?? 0
  const availableHoldings = Math.max(0, currentHoldings - lockedSellQty)

  const isBuyExceeded = side === 'BUY' && estimatedTotal > availableCash
  const isSellExceeded = side === 'SELL' && quantity > availableHoldings

  const canSubmit =
    !disabled &&
    !marketPaused &&
    !submitting &&
    Boolean(teamState) &&
    Boolean(selectedStock) &&
    isValidQuantity &&
    !isBuyExceeded &&
    !isSellExceeded

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      await onSubmitOrder({
        stockId: activeStockId,
        side,
        quantity,
      })
      const companyLabel = selectedCompany?.name ?? '選択した銘柄'
      setSuccessMsg(
        `${companyLabel} の${formatOrderSide(side)}注文（${quantity}株）を送信しました。`,
      )
    } catch (err: unknown) {
      setErrorMsg(
        describeUserFacingError(
          err,
          '注文を送信できませんでした。もう一度お試しください。',
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const companyMap = new Map(companies.map((c) => [c.id, c]))

  return (
    <Stack spacing={3} sx={{ width: '100%' }}>
      {marketPaused && (
        <Alert severity="warning">
          市場は現在停止中です。注文の新規受付は一時停止されています。
        </Alert>
      )}

      {errorMsg && (
        <Alert severity="error" onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {/* Account Overview */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }} gutterBottom>
            チーム資産状況
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1, flex: 1 }}>
              <Typography variant="caption" color="text.secondary">
                保有現金: {cash.toLocaleString()} 円
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                利用可能現金: {availableCash.toLocaleString()} 円
              </Typography>
              {lockedBuyValue > 0 && (
                <Typography variant="caption" color="warning.main">
                  (注文拘束中: {lockedBuyValue.toLocaleString()} 円)
                </Typography>
              )}
            </Box>
          </Stack>

          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            保有株式一覧
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
            {companies.map((c) => {
              const qty = teamState?.holdings?.[c.id] ?? 0
              const locked = teamState?.lockedSellQuantity?.[c.id] ?? 0
              return (
                <Chip
                  key={c.id}
                  label={`${c.name}: ${qty}株${locked > 0 ? ` (拘束 ${locked}株)` : ''}`}
                  variant={qty > 0 ? 'filled' : 'outlined'}
                  color={qty > 0 ? 'primary' : 'default'}
                />
              )
            })}
          </Stack>
        </CardContent>
      </Card>

      {/* Order Placement Form */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }} gutterBottom>
            新規注文発注
          </Typography>

          <Box component="form" onSubmit={(e) => void handleSubmit(e)}>
            <Stack spacing={2.5}>
              <FormControl fullWidth>
                <InputLabel id="order-stock-select-label">銘柄選択</InputLabel>
                <Select
                  labelId="order-stock-select-label"
                  label="銘柄選択"
                  value={activeStockId}
                  onChange={(e) => setSelectedStockId(e.target.value)}
                  disabled={disabled || submitting}
                >
                  {companies.map((c) => {
                    const price = stocks[c.id]?.currentPrice
                    return (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name} ({c.symbol}) - 現在値: {price !== undefined ? `${price.toLocaleString()}円` : '未取得'}
                      </MenuItem>
                    )
                  })}
                </Select>
              </FormControl>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  売買区分
                </Typography>
                <ToggleButtonGroup
                  value={side}
                  exclusive
                  onChange={(_, val) => { if (val) setSide(val) }}
                  disabled={disabled || submitting}
                  fullWidth
                >
                  <ToggleButton value="BUY" color="primary">
                    {formatOrderSide('BUY')}
                  </ToggleButton>
                  <ToggleButton value="SELL" color="secondary">
                    {formatOrderSide('SELL')}
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
                <TextField
                  label="注文株数"
                  type="number"
                  value={quantityStr}
                  onChange={(e) => setQuantityStr(e.target.value)}
                  disabled={disabled || submitting}
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 1, step: 1 },
                  }}
                  helperText={
                    side === 'BUY'
                      ? `購入可能目安: ${currentPrice > 0 ? Math.floor(availableCash / currentPrice) : 0}株`
                      : `売却可能株数: ${availableHoldings}株`
                  }
                  error={isBuyExceeded || isSellExceeded}
                />

                <Box sx={{ minWidth: 200, textAlign: { xs: 'left', sm: 'right' } }}>
                  <Typography variant="caption" color="text.secondary">
                    概算約定代金 (現在値基準)
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    {estimatedTotal.toLocaleString()} 円
                  </Typography>
                </Box>
              </Stack>

              {isBuyExceeded && (
                <Typography variant="caption" color="error">
                  利用可能現金が不足しています（不足額: {(estimatedTotal - availableCash).toLocaleString()} 円）
                </Typography>
              )}

              {isSellExceeded && (
                <Typography variant="caption" color="error">
                  売却可能株数が不足しています（不足: {quantity - availableHoldings} 株）
                </Typography>
              )}

              <Button
                type="submit"
                variant="contained"
                size="large"
                color={side === 'BUY' ? 'primary' : 'secondary'}
                disabled={!canSubmit}
                startIcon={submitting ? <CircularProgress size={20} color="inherit" /> : undefined}
                sx={{ py: 1.5 }}
              >
                {submitting ? '注文送信中...' : `${formatOrderSide(side)}注文を出す`}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      {/* Order History */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }} gutterBottom>
            注文履歴
          </Typography>

          {!teamState?.myOrders || teamState.myOrders.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              注文履歴はありません。
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>銘柄</TableCell>
                    <TableCell>売買</TableCell>
                    <TableCell align="right">株数</TableCell>
                    <TableCell align="right">発注時参照価格</TableCell>
                    <TableCell>状態</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {teamState.myOrders.map((order) => {
                    const c = companyMap.get(order.stockId)
                    return (
                      <TableRow key={order.orderId}>
                        <TableCell>
                          {c ? `${c.name} (${c.symbol})` : '銘柄名を確認できません'}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={formatOrderSide(order.side)}
                            size="small"
                            color={
                              order.side === 'BUY'
                                ? 'primary'
                                : order.side === 'SELL'
                                  ? 'secondary'
                                  : 'default'
                            }
                          />
                        </TableCell>
                        <TableCell align="right">{order.quantity}株</TableCell>
                        <TableCell align="right">{order.referencePrice.toLocaleString()}円</TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {formatOrderStatus(order.status)}
                            {order.executionPrice !== undefined &&
                              ` (約定価格: ${order.executionPrice.toLocaleString()}円)`}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Stack>
  )
}
