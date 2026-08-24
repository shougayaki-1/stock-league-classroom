import type {
  CompanyPublicView,
  CompanySizeClass,
  EconomicIndicatorKind,
  InformationCategory,
  InformationConfidence,
  InformationNature,
  ResearchDeskPanelId,
} from '@stock-league/market-public-content'
import type { MyOrderView } from '../lessonRuns/liveTypes'
import { safeLabel } from './safeLabel'

type CompanyGrowthProfile = NonNullable<CompanyPublicView['growthProfile']>
type CompanyFinancialStrength = NonNullable<CompanyPublicView['financialStrength']>
type OrderSide = MyOrderView['side']
type OrderStatus = MyOrderView['status']

export const COMPANY_SIZE_LABELS = {
  SMALL: '小型株',
  MEDIUM: '中型株',
  LARGE: '大型株',
} satisfies Record<CompanySizeClass, string>

export const COMPANY_GROWTH_PROFILE_LABELS = {
  STABLE: '安定型',
  GROWTH: '成長型',
  CYCLICAL: '景気循環型',
} satisfies Record<CompanyGrowthProfile, string>

export const COMPANY_FINANCIAL_STRENGTH_LABELS = {
  WEAK: 'やや弱い',
  STANDARD: '標準',
  STRONG: '強い',
} satisfies Record<CompanyFinancialStrength, string>

export const INFORMATION_CATEGORY_LABELS = {
  OFFICIAL_NEWS: '公式発表',
  MARKET_DATA: '市況データ',
  EARNINGS: '決算情報',
  ANALYSIS: 'アナリスト分析',
  UNVERIFIED: '未確認情報',
} satisfies Record<InformationCategory, string>

export const INFORMATION_NATURE_LABELS = {
  FACT: '事実',
  FORECAST: '予測',
  OPINION: '意見',
} satisfies Record<InformationNature, string>

export const INFORMATION_CONFIDENCE_LABELS = {
  HIGH: '確度: 高',
  MEDIUM: '確度: 中',
  UNKNOWN: '確度: 不明',
} satisfies Record<InformationConfidence, string>

export const ECONOMIC_INDICATOR_KIND_LABELS = {
  ECONOMY: '景気',
  PRICE: '物価',
  INTEREST_RATE: '金利',
  FX: '為替',
  POLICY: '政策',
} satisfies Record<EconomicIndicatorKind, string>

export const RESEARCH_DESK_PANEL_LABELS = {
  COMPANIES: '企業情報',
  NEWS: 'ニュース',
  STATISTICS: '統計資料',
  TEAM_NOTES: 'チームノート',
  ORDERS: '注文',
} satisfies Record<ResearchDeskPanelId, string>

export const ORDER_SIDE_LABELS = {
  BUY: '買い',
  SELL: '売り',
} satisfies Record<OrderSide, string>

export const ORDER_STATUS_LABELS = {
  PENDING: '受付済み（次バッチ待ち）',
  CANCELLED: '取消済み',
  PROCESSING: '処理中',
  FILLED: '約定済み',
  REJECTED: '不成立・却下',
} satisfies Record<OrderStatus, string>

export const formatCompanySize = (value: string | null | undefined): string =>
  safeLabel(value, COMPANY_SIZE_LABELS, '企業規模を確認できません')
export const formatCompanyGrowthProfile = (value: string | null | undefined): string =>
  safeLabel(value, COMPANY_GROWTH_PROFILE_LABELS, '成長特性を確認できません')
export const formatCompanyFinancialStrength = (value: string | null | undefined): string =>
  safeLabel(value, COMPANY_FINANCIAL_STRENGTH_LABELS, '財務状態を確認できません')
export const formatInformationCategory = (value: string | null | undefined): string =>
  safeLabel(value, INFORMATION_CATEGORY_LABELS, 'ニュース種別を確認できません')
export const formatInformationNature = (value: string | null | undefined): string =>
  safeLabel(value, INFORMATION_NATURE_LABELS, '情報の性質を確認できません')
export const formatInformationConfidence = (value: string | null | undefined): string =>
  safeLabel(value, INFORMATION_CONFIDENCE_LABELS, '確度を確認できません')
export const formatEconomicIndicatorKind = (value: string | null | undefined): string =>
  safeLabel(value, ECONOMIC_INDICATOR_KIND_LABELS, '統計種別を確認できません')
export const formatResearchDeskPanel = (value: string | null | undefined): string =>
  safeLabel(value, RESEARCH_DESK_PANEL_LABELS, '機能名を確認できません')
export const formatOrderSide = (value: string | null | undefined): string =>
  safeLabel(value, ORDER_SIDE_LABELS, '売買区分を確認できません')
export const formatOrderStatus = (value: string | null | undefined): string =>
  safeLabel(value, ORDER_STATUS_LABELS, '注文状態を確認できません')
