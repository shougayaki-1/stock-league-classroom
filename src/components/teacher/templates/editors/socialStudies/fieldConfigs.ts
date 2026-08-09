import type { InformationItem, SimulatedCompany } from '@stock-league/market-authoring-content'
import type { ArrayItemFieldConfig } from '../ArrayFieldEditor'

let nextId = 0
const id = (prefix: string) => `${prefix}-${++nextId}`
export const companyFields: ArrayItemFieldConfig<SimulatedCompany>[] = [{ key: 'name', label: '企業名', type: 'text' }, { key: 'symbol', label: '銘柄コード', type: 'text' }, { key: 'industry', label: '業種', type: 'text' }, { key: 'initialPrice', label: '初期株価（円）', type: 'number' }]
export const createEmptyCompany = (): SimulatedCompany => ({ id: id('company'), name: '', symbol: '', industry: '', description: '', productsAndServices: [], costDrivers: [], sizeClass: 'MEDIUM', financialStrength: 'STANDARD', growthProfile: 'STABLE', riskFactors: [], initialPrice: 1000, minimumPriceGuard: { type: 'PERCENT_OF_INITIAL', minimumPercent: 30 }, impactSensitivities: {} })
export const informationItemFields: ArrayItemFieldConfig<InformationItem>[] = [{ key: 'source', label: '出典', type: 'text' }, { key: 'body', label: '本文', type: 'text' }]
export const createEmptyInformationItem = (): InformationItem => ({ id: id('info'), category: 'OFFICIAL_NEWS', source: '', publishedAtMillis: Date.now(), natureType: 'FACT', confidenceLevel: 'HIGH', targetCompanyIds: [], body: '', impact: { baseDirection: 'NEUTRAL', strength: 0 } })
