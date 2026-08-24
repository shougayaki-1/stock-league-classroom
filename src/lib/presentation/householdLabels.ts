import type {
  AssetPosition,
  CourseFormat,
  GoalPackage,
  HouseholdProfile,
  Liability,
} from '@stock-league/household-authoring-content'
import type { AdvancedHouseholdTeamStateView } from '../lessonRuns/liveTypes'
import { safeLabel } from './safeLabel'

type HouseholdLifeStage = HouseholdProfile['lifeStage']
type HouseholdAssetType = AssetPosition['assetType']
type HouseholdLiabilityKind = Liability['kind']
type HouseholdRoundStatus = AdvancedHouseholdTeamStateView['roundStatus']

export type HouseholdConcept =
  | 'INSURANCE'
  | 'HOUSING'
  | 'ASSET_DIVERSIFICATION'
  | 'RETIREMENT_PLANNING'
  | 'EMERGENCY_FUND'
  | 'EDUCATION_FUND'
  | 'RISK_MANAGEMENT'

export const HOUSEHOLD_LIFE_STAGE_LABELS = {
  STUDENT: '学生期',
  INDEPENDENT: '独立期',
  FAMILY_FORMATION: '家族形成期',
  CHILD_REARING: '子育て期',
  PRE_RETIREMENT: '退職準備期',
  RETIRED: '退職後',
} satisfies Record<HouseholdLifeStage, string>

export const HOUSEHOLD_ASSET_TYPE_LABELS = {
  CASH: '現金',
  SAVINGS_DEPOSIT: '預貯金',
  BOND: '債券',
  DOMESTIC_STOCK: '国内株式',
  FOREIGN_STOCK: '外国株式',
  INVESTMENT_TRUST: '投資信託',
} satisfies Record<HouseholdAssetType, string>

export const HOUSEHOLD_COURSE_FORMAT_LABELS = {
  COMMON_CONDITIONS: '共通条件',
  ROLE_VARIANT: '役割別',
  STAGE_SPLIT: 'ライフステージ別',
  MULTI_PERSON_PER_TEAM: 'チーム内複数世帯',
} satisfies Record<CourseFormat, string>

export const HOUSEHOLD_LIABILITY_KIND_LABELS = {
  MORTGAGE: '住宅ローン',
  OTHER_LOAN: 'その他の借入',
} satisfies Record<HouseholdLiabilityKind, string>

export const HOUSEHOLD_GOAL_PACKAGE_LABELS = {
  EMERGENCY_FUND: '緊急資金',
  HOME_PURCHASE: '住宅購入',
  EDUCATION_FUND: '教育資金',
  RETIREMENT_PREP: '退職準備',
  RISK_DIVERSIFICATION: 'リスク分散',
  INSURANCE_AND_PREPAREDNESS: '保険と備え',
  OVERALL_BALANCE: '総合バランス',
} satisfies Record<GoalPackage, string>

export const HOUSEHOLD_CONCEPT_LABELS = {
  INSURANCE: '保険',
  HOUSING: '住宅ローン',
  ASSET_DIVERSIFICATION: '資産分散',
  RETIREMENT_PLANNING: '老後資金',
  EMERGENCY_FUND: '緊急資金',
  EDUCATION_FUND: '教育資金',
  RISK_MANAGEMENT: 'リスク管理',
} satisfies Record<HouseholdConcept, string>

export const HOUSEHOLD_ROUND_STATUS_LABELS = {
  OPEN: '受付中',
  SETTLING: '集計中',
} satisfies Record<HouseholdRoundStatus, string>

export const formatHouseholdLifeStage = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_LIFE_STAGE_LABELS, 'ライフステージを確認できません')
export const formatHouseholdAssetType = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_ASSET_TYPE_LABELS, '資産種別を確認できません')
export const formatHouseholdCourseFormat = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_COURSE_FORMAT_LABELS, '授業形式を確認できません')
export const formatHouseholdLiabilityKind = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_LIABILITY_KIND_LABELS, '借入種別を確認できません')
export const formatHouseholdGoalPackage = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_GOAL_PACKAGE_LABELS, '学習目標を確認できません')
export const formatHouseholdConcept = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_CONCEPT_LABELS, '学習項目を確認できません')
export const formatHouseholdRoundStatus = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_ROUND_STATUS_LABELS, 'ラウンド状態を確認できません')
