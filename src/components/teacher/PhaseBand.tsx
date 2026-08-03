import { Stack, Typography } from '@mui/material'
import type { MarketStatus } from '../../lib/market/liveMarketTypes'
import { MARKET_PHASE_ORDER, MARKET_STATUS_LABEL } from '../../lib/market/marketStatusLabels'

export interface PhaseBandProps {
  status: MarketStatus
  openedAtMillis?: number
  nowMillis: number
  participantCount: number
  capacity: number
  pendingOrderCount: number
}

export const describeElapsed = (openedAtMillis: number | undefined, nowMillis: number): string => {
  if (openedAtMillis === undefined) return '未開始'
  const seconds = Math.max(0, Math.floor((nowMillis - openedAtMillis) / 1000))
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
    <Typography color="text.secondary">{label}</Typography>
    <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
  </Stack>
)

export function PhaseBand({ status, openedAtMillis, nowMillis, participantCount, capacity, pendingOrderCount }: PhaseBandProps) {
  const currentIndex = MARKET_PHASE_ORDER.indexOf(status)
  return (
    <Stack component="section" aria-label="市場フェーズ" spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {MARKET_PHASE_ORDER.map((phase, index) => (
          <Stack key={phase} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography
              component="span"
              aria-current={index === currentIndex ? 'step' : undefined}
              sx={{
                px: 1.5, py: 0.5, borderRadius: 999, fontWeight: 700, fontSize: 13,
                bgcolor: index === currentIndex ? 'primary.main' : 'action.hover',
                color: index === currentIndex ? 'primary.contrastText' : 'text.secondary',
              }}
            >
              {MARKET_STATUS_LABEL[phase]}
            </Typography>
            {index < MARKET_PHASE_ORDER.length - 1 && <Typography color="text.secondary" aria-hidden="true">→</Typography>}
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
        <Metric label="経過時間" value={describeElapsed(openedAtMillis, nowMillis)} />
        <Metric label="参加者" value={`${participantCount} / ${capacity}`} />
        <Metric label="未処理の注文" value={String(pendingOrderCount)} />
      </Stack>
    </Stack>
  )
}
