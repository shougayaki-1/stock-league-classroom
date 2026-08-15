import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import type { CompanyPublicView, InformationPublicView } from '@stock-league/market-public-content'

export interface NewsListPageProps {
  informationItems: InformationPublicView[]
  companies?: CompanyPublicView[]
}

const CATEGORY_LABELS: Record<string, string> = {
  OFFICIAL_NEWS: '公式発表',
  MARKET_DATA: '市況データ',
  EARNINGS: '決算情報',
  ANALYSIS: 'アナリスト分析',
  UNVERIFIED: '未確認情報',
}

const NATURE_LABELS: Record<string, string> = {
  FACT: '事実',
  FORECAST: '予測',
  OPINION: '意見',
}

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: '確度: 高',
  MEDIUM: '確度: 中',
  UNKNOWN: '確度: 不明',
}

export function NewsListPage({ informationItems, companies = [] }: NewsListPageProps) {
  if (informationItems.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          公開されているニュースはありません。
        </Typography>
      </Box>
    )
  }

  const companyMap = new Map(companies.map((c) => [c.id, c]))

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Typography variant="subtitle2" color="text.secondary">
        公開ニュース一覧 ({informationItems.length}件)
      </Typography>

      {informationItems.map((item) => {
        const targetCompanies = item.targetCompanyIds
          .map((id) => companyMap.get(id))
          .filter((c): c is CompanyPublicView => Boolean(c))

        return (
          <Card key={item.id} variant="outlined">
            <CardContent>
              <Stack spacing={1.5}>
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" component="span" sx={{ fontWeight: 'bold' }}>
                      {item.source}
                    </Typography>
                    <Chip
                      label={CATEGORY_LABELS[item.category] ?? item.category}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    <Chip
                      label={NATURE_LABELS[item.natureType] ?? item.natureType}
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label={CONFIDENCE_LABELS[item.confidenceLevel] ?? item.confidenceLevel}
                      size="small"
                      color={item.confidenceLevel === 'HIGH' ? 'success' : 'default'}
                    />
                  </Stack>
                </Stack>

                {targetCompanies.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    対象: {targetCompanies.map((c) => `${c.name} (${c.symbol})`).join(', ')}
                  </Typography>
                )}

                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                  {item.body}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        )
      })}
    </Stack>
  )
}
