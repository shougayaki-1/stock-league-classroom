import { normalizePhases } from '../pricing/pricingCore'
import type { TemplateCompany, TemplateSpec, TemplateTeam } from './types'

export const TEMPLATE_LIMITS = {
  title: 80,
  description: 500,
  minTeams: 2,
  maxTeams: 8,
  minCompanies: 1,
  maxCompanies: 20,
  maxTeamName: 30,
  maxCompanyName: 80,
  maxSymbol: 10,
  maxStartingCash: 1_000_000_000,
  maxPrice: 10_000_000,
} as const

const unique = (values: string[]) => new Set(values).size === values.length

export const validateTemplate = (spec: TemplateSpec): string[] => {
  const errors: string[] = []
  if (!spec.title.trim() || spec.title.trim().length > TEMPLATE_LIMITS.title) errors.push('テンプレート名は1〜80文字で入力してください。')
  if (spec.description.length > TEMPLATE_LIMITS.description) errors.push('説明は500文字以内で入力してください。')
  if (!Number.isInteger(spec.startingCash) || spec.startingCash < 1 || spec.startingCash > TEMPLATE_LIMITS.maxStartingCash) errors.push('初期資金は1〜10億円の整数で入力してください。')
  if (spec.teams.length < TEMPLATE_LIMITS.minTeams || spec.teams.length > TEMPLATE_LIMITS.maxTeams) errors.push('チームは2〜8件設定してください。')
  if (!unique(spec.teams.map((team) => team.name.trim()))) errors.push('チーム名は重複できません。')
  if (spec.teams.some((team) => !team.id || !team.name.trim() || team.name.trim().length > TEMPLATE_LIMITS.maxTeamName)) errors.push('各チームに30文字以内の名前を設定してください。')
  if (spec.companies.length < TEMPLATE_LIMITS.minCompanies || spec.companies.length > TEMPLATE_LIMITS.maxCompanies) errors.push('銘柄は1〜20件設定してください。')
  if (!unique(spec.companies.map((company) => company.symbol.trim().toUpperCase()))) errors.push('銘柄コードは重複できません。')
  if (spec.companies.some((company) => !company.id || !company.name.trim() || company.name.trim().length > TEMPLATE_LIMITS.maxCompanyName)) errors.push('各銘柄に80文字以内の会社名を設定してください。')
  if (spec.companies.some((company) => !company.symbol.trim() || company.symbol.trim().length > TEMPLATE_LIMITS.maxSymbol)) errors.push('銘柄コードは1〜10文字で設定してください。')
  if (spec.companies.some((company) => !Number.isInteger(company.initialPrice) || company.initialPrice < 1 || company.initialPrice > TEMPLATE_LIMITS.maxPrice)) errors.push('初期価格は1〜1,000万円の整数で設定してください。')
  return errors
}

export const normalizeTemplate = (spec: TemplateSpec): TemplateSpec => ({
  title: spec.title.trim(),
  description: spec.description.trim(),
  startingCash: Math.round(spec.startingCash),
  teams: spec.teams.map((team: TemplateTeam) => ({ id: team.id, name: team.name.trim() })),
  companies: spec.companies.map((company: TemplateCompany) => ({
    ...company,
    name: company.name.trim(),
    symbol: company.symbol.trim().toUpperCase(),
    initialPrice: Math.round(company.initialPrice),
    initialShares: Math.max(1, Math.round(company.initialShares)),
    pricePhases: normalizePhases(company.pricePhases),
  })),
})

export const assertValidTemplate = (spec: TemplateSpec): TemplateSpec => {
  const normalized = normalizeTemplate(spec)
  const errors = validateTemplate(normalized)
  if (errors.length) throw new Error(errors[0])
  return normalized
}
