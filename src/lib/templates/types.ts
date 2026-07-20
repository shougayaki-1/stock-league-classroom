export type TemplateVisibility = 'private' | 'official'

export interface TemplateCompany {
  id: string
  name: string
  symbol: string
  initialPrice: number
  initialShares: number
  /** Optional configured intrahour price schedule; absence deliberately means flat. */
  pricePhases?: import('../pricing/types').StockPricePhase[]
}

/** The complete, portable market definition. Market creation stores a copy of this value. */
export interface TemplateSpec {
  title: string
  description: string
  startingCash: number
  companies: TemplateCompany[]
}

export interface PersonalTemplate extends TemplateSpec {
  id: string
  ownerUid: string
  visibility: 'private'
  createdAt: number
  updatedAt: number
}

export interface OfficialTemplate extends TemplateSpec {
  id: string
  visibility: 'official'
  createdAt: number
  updatedAt: number
}

export interface TemplateShare {
  id: string
  /** Immutable copy: resolving a link never reads a private template. */
  snapshot: TemplateSpec
  createdByUid: string
  createdAt: number
}

export type Template = PersonalTemplate | OfficialTemplate
