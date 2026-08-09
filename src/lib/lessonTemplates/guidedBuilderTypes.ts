export type LearningGoal = 'MARKET_AND_INVESTING' | 'LIFE_PLANNING'
export type GuidedBuilderTier = 'EASY' | 'STANDARD' | 'ADVANCED'

export interface CommonWizardAnswers {
  mainObjective: string; lessonDurationMinutes: number; studentCount: number
  deviceEnvironment: 'ONE_PER_STUDENT' | 'SHARED' | 'MIXED'; teamMode: 'INDIVIDUAL' | 'TEAM'
  readingDepth: 'LIGHT' | 'STANDARD' | 'DEEP'; theme: string; difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED'
}
export interface SocialStudiesWizardAnswers {
  companyCount: number; useEarnings: boolean; useUncertainty: boolean
  infoVsDemandWeight: 'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED'; alwaysOnMarketMinutes: number
  predictionCheckpoints: number; evaluationFocus: 'OPERATION_RESULT' | 'PREDICTION_ACCURACY' | 'INFORMATION_USAGE' | 'RISK_MANAGEMENT'
}
export interface HomeEconomicsWizardAnswers {
  lifeStageFocus: 'STUDENT' | 'INDEPENDENT' | 'FAMILY_FORMATION' | 'CHILD_REARING' | 'PRE_RETIREMENT' | 'RETIRED'
  courseFormat: 'COMMON_CONDITIONS' | 'ROLE_VARIANT'; roundYears: 1 | 5
  coveredConcepts: Array<'ASSETS' | 'INSURANCE' | 'HOUSING'>; eventDisclosure: 'ANNOUNCED' | 'PARTIALLY_ANNOUNCED' | 'HIDDEN'
  evaluationFocus: 'LIFE_GOAL_ACHIEVEMENT' | 'STABILITY' | 'DIVERSIFICATION' | 'BORROWING_BURDEN'
}
export type WizardAnswers =
  | ({ goal: 'MARKET_AND_INVESTING' } & CommonWizardAnswers & SocialStudiesWizardAnswers)
  | ({ goal: 'LIFE_PLANNING' } & CommonWizardAnswers & HomeEconomicsWizardAnswers)
