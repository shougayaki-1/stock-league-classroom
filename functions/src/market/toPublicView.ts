/**
 * The sole place that decides what students may see about companies,
 * information items, and economic indicators. Fixed here (server-side,
 * Functions) rather than as an import-boundary rule on the authoring
 * package, because the client cannot rewrite server code — see the header
 * comments on `@stock-league/market-public-content` and
 * `@stock-league/market-authoring-content` for the full architecture note
 * (spec §12.4–§12.8).
 */
import type {
  CompanyDifficultyTier,
  CompanyPublicView,
  EconomicIndicatorDifficultyTier,
  EconomicIndicatorPublicView,
  InformationPublicView,
} from '@stock-league/market-public-content'
import type { EconomicIndicatorAuthoring, InformationItem, SimulatedCompany } from '@stock-league/market-authoring-content'

export const toCompanyPublicView = (
  company: SimulatedCompany,
  tier: CompanyDifficultyTier,
): CompanyPublicView => {
  const base: CompanyPublicView = {
    id: company.id, name: company.name, symbol: company.symbol,
    industry: company.industry, description: company.description,
    productsAndServices: company.productsAndServices,
    sizeClass: company.sizeClass, riskFactors: company.riskFactors,
  }
  if (tier === 'BASIC') return base
  const standard: CompanyPublicView = {
    ...base,
    domesticRevenueRatio: company.domesticRevenueRatio,
    overseasRevenueRatio: company.overseasRevenueRatio,
    costDrivers: company.costDrivers,
    growthProfile: company.growthProfile,
  }
  if (tier === 'STANDARD') return standard
  return { ...standard, financialStrength: company.financialStrength }
}

export const toInformationPublicView = (item: InformationItem): InformationPublicView => ({
  id: item.id, category: item.category, source: item.source,
  publishedAtMillis: item.publishedAtMillis, natureType: item.natureType,
  confidenceLevel: item.confidenceLevel, targetCompanyIds: item.targetCompanyIds,
  body: item.body,
})

export const toEconomicIndicatorPublicView = (
  indicator: EconomicIndicatorAuthoring,
  tier: EconomicIndicatorDifficultyTier,
): EconomicIndicatorPublicView => {
  const base: EconomicIndicatorPublicView = {
    id: indicator.id, kind: indicator.kind,
    publishedAtMillis: indicator.publishedAtMillis, label: indicator.label,
  }
  if (tier === 'BASIC') return base
  return { ...base, value: indicator.value, changeFromPrevious: indicator.changeFromPrevious }
}
