import type { SocialStudiesMarketContent } from '@stock-league/market-authoring-content'

export type ValidationResult = { valid: true } | { valid: false; errors: string[] }

export const validateSocialStudiesMarketContent = (
  content: SocialStudiesMarketContent,
): ValidationResult => {
  const errors: string[] = []

  if (content.companies.length < 3) errors.push('企業は3社以上必要です。')
  if (content.companies.length > 6) errors.push('企業は6社以下にしてください。')

  const symbolCounts = new Map<string, number>()
  for (const company of content.companies) {
    symbolCounts.set(company.symbol, (symbolCounts.get(company.symbol) ?? 0) + 1)
  }
  for (const [symbol, count] of symbolCounts) {
    if (count > 1) errors.push(`銘柄コードが重複しています: ${symbol}`)
  }

  if (content.batchIntervalSeconds < 1 || content.batchIntervalSeconds > 10) {
    errors.push('処理間隔は1〜10秒にしてください。')
  }

  const companyIds = new Set(content.companies.map((c) => c.id))
  for (const item of content.informationItems) {
    for (const targetId of item.targetCompanyIds) {
      if (!companyIds.has(targetId)) {
        errors.push(`情報 ${item.id} が存在しない企業を参照しています: ${targetId}`)
      }
    }
  }
  for (const indicator of content.economicIndicators) {
    for (const companyId of Object.keys(indicator.companyImpactMultipliers)) {
      if (!companyIds.has(companyId)) {
        errors.push(`指標 ${indicator.id} が存在しない企業を参照しています: ${companyId}`)
      }
    }
  }

  const weightSum = Object.values(content.evaluationWeights).reduce((a, b) => a + b, 0)
  if (Math.abs(weightSum - 1) > 1e-9) {
    errors.push(`評価の重みの合計は1にしてください（現在: ${weightSum}）。`)
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
