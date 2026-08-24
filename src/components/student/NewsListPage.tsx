import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import type { CompanyPublicView, InformationPublicView } from '@stock-league/market-public-content'
import {
  formatInformationCategory,
  formatInformationConfidence,
  formatInformationNature,
} from '../../lib/presentation/marketLabels'

export interface NewsListPageProps {
  informationItems: InformationPublicView[]
  companies?: CompanyPublicView[]
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
                      label={formatInformationCategory(item.category)}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    <Chip
                      label={formatInformationNature(item.natureType)}
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label={formatInformationConfidence(item.confidenceLevel)}
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
