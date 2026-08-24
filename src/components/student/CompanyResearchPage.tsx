import { useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import type { CompanyPublicView } from '@stock-league/market-public-content'
import {
  formatCompanyFinancialStrength,
  formatCompanyGrowthProfile,
  formatCompanySize,
} from '../../lib/presentation/marketLabels'

export interface CompanyResearchPageProps {
  companies: CompanyPublicView[]
}

export function CompanyResearchPage({ companies }: CompanyResearchPageProps) {
  const [selectedId, setSelectedId] = useState<string>(companies[0]?.id ?? '')

  if (companies.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          閲覧可能な企業情報はありません。
        </Typography>
      </Box>
    )
  }

  const selectedCompany = companies.find((c) => c.id === selectedId) ?? companies[0]

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ width: '100%' }}>
      <Box sx={{ width: { xs: '100%', md: 240 }, flexShrink: 0 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, px: 1 }}>
          企業一覧 ({companies.length})
        </Typography>
        <List sx={{ bgcolor: 'background.paper', borderRadius: 1, p: 0 }}>
          {companies.map((company) => {
            const isSelected = company.id === selectedCompany.id
            return (
              <ListItem key={company.id} disablePadding>
                <ListItemButton
                  selected={isSelected}
                  onClick={() => setSelectedId(company.id)}
                  aria-label={`${company.name} (${company.symbol})`}
                >
                  <ListItemText
                    primary={company.name}
                    secondary={`${company.symbol} • ${company.industry}`}
                    slotProps={{ primary: { sx: { fontWeight: isSelected ? 'bold' : 'normal' } } }}
                  />
                </ListItemButton>
              </ListItem>
            )
          })}
        </List>
      </Box>

      <Box sx={{ flexGrow: 1 }}>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="h5" component="h2">
                    {selectedCompany.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    証券コード: {selectedCompany.symbol} | 業種: {selectedCompany.industry}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Chip
                    label={formatCompanySize(selectedCompany.sizeClass)}
                    size="small"
                    variant="outlined"
                  />
                  {selectedCompany.growthProfile && (
                    <Chip
                      label={formatCompanyGrowthProfile(selectedCompany.growthProfile)}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  )}
                  {selectedCompany.financialStrength && (
                    <Chip
                      label={formatCompanyFinancialStrength(selectedCompany.financialStrength)}
                      size="small"
                      color="secondary"
                      variant="outlined"
                    />
                  )}
                </Stack>
              </Stack>

              <Divider />

              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  企業概要
                </Typography>
                <Typography variant="body1">
                  {selectedCompany.description}
                </Typography>
              </Box>

              {selectedCompany.productsAndServices && selectedCompany.productsAndServices.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    主要製品・サービス
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
                    {selectedCompany.productsAndServices.map((product, idx) => (
                      <Chip key={idx} label={product} size="small" />
                    ))}
                  </Stack>
                </Box>
              )}

              {(selectedCompany.domesticRevenueRatio !== undefined || selectedCompany.overseasRevenueRatio !== undefined) && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    売上構成
                  </Typography>
                  <Typography variant="body2">
                    国内 {Math.round((selectedCompany.domesticRevenueRatio ?? 0) * 100)}% / 海外 {Math.round((selectedCompany.overseasRevenueRatio ?? 0) * 100)}%
                  </Typography>
                </Box>
              )}

              {selectedCompany.costDrivers && selectedCompany.costDrivers.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    主なコスト要因
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
                    {selectedCompany.costDrivers.map((driver, idx) => (
                      <Chip key={idx} label={driver} size="small" variant="outlined" />
                    ))}
                  </Stack>
                </Box>
              )}

              {selectedCompany.riskFactors && selectedCompany.riskFactors.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" color="error.main" gutterBottom>
                    リスク要因
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
                    {selectedCompany.riskFactors.map((risk, idx) => (
                      <Chip key={idx} label={risk} size="small" color="error" variant="outlined" />
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  )
}
