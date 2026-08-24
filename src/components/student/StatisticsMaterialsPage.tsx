import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material'
import type { EconomicIndicatorPublicView } from '@stock-league/market-public-content'
import { formatEconomicIndicatorKind } from '../../lib/presentation/marketLabels'

export interface StatisticsMaterialsPageProps {
  economicIndicators: EconomicIndicatorPublicView[]
}

export function StatisticsMaterialsPage({ economicIndicators }: StatisticsMaterialsPageProps) {
  if (economicIndicators.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          公開されている統計資料はありません。
        </Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Typography variant="subtitle2" color="text.secondary">
        公開統計資料・指標一覧 ({economicIndicators.length}件)
      </Typography>

      <Grid container spacing={2}>
        {economicIndicators.map((item) => {
          const hasChange = item.changeFromPrevious !== undefined
          const isPositive = (item.changeFromPrevious ?? 0) > 0
          const formattedChange = hasChange
            ? `${isPositive ? '+' : ''}${item.changeFromPrevious}`
            : null

          return (
            <Grid key={item.id} size={{ xs: 12, sm: 6 }}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Chip
                        label={formatEconomicIndicatorKind(item.kind)}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    </Box>

                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      {item.label}
                    </Typography>

                    {item.value !== undefined && (
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                        <Typography variant="h5" component="span" sx={{ fontWeight: 'bold' }}>
                          {item.value}
                        </Typography>
                        {formattedChange && (
                          <Typography
                            variant="body2"
                            component="span"
                            color={isPositive ? 'success.main' : item.changeFromPrevious === 0 ? 'text.secondary' : 'error.main'}
                            sx={{ fontWeight: 'bold' }}
                          >
                            {formattedChange}
                          </Typography>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          )
        })}
      </Grid>
    </Stack>
  )
}
