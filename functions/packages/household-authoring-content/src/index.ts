import type { AssetType, LifeStage } from '@stock-league/household-public-content'

/**
 * Teacher-authoring / server-internal type. Imported by BOTH `src/`
 * (teacher's own material-authoring UI legitimately edits
 * eventProbabilityOverrides/internalRiskFactors — the teacher is the
 * author of these values) and `functions/` (the engine's input). What
 * must never happen is a STUDENT receiving this data — that is enforced
 * by Firestore rules (teacher read-only) and by
 * `functions/src/homeEconomics/toPublicView.ts` being the only producer
 * of what lands in the student-readable RTDB path, not by import
 * restrictions. See `functions/src/market/toPublicView.ts` (Phase C
 * Task1) for the identical architecture note.
 */
export interface HouseholdProfile {
  householdId: string
  age: number
  householdIncomeYen: number
  annualLivingExpensesYen: number
  cashSavingsYen: number
  family: string
  housing: string
  lifeGoal: string
  lifeStage: LifeStage
  /** Hidden. Never sent to students. Keyed by life-event id. */
  eventProbabilityOverrides: Record<string, number>
  /** Hidden. Never sent to students. */
  internalRiskFactors: Record<string, number>
}

export interface AssetPosition {
  assetType: AssetType
  valueYen: number
  /** Hidden. Drives assetReturn.ts (Task 4). Never sent to students — spec §13.15 "教師には計算式より影響の強さを見せる". */
  expectedReturnPercent: number
  /** Hidden. Drives the noise term in assetReturn.ts. Never sent to students. */
  volatilityPercent: number
}

export interface InsuranceProduct {
  id: string
  productName: string
  premiumYenPerYear: number
  coveredRisk: string
  benefitDescription: string
  benefitAmountYen: number
  contractYears: number
  /** Which LifeEventDefinition ids this product pays out on — links Task 6's insurance.ts to Task 7's lifeEvents.ts without a text-matching heuristic against `coveredRisk` (a display string, not an identifier). */
  coveredEventIds: string[]
  /** Hidden. Internal claim-probability model — used only for teacher-facing "influence strength" display (spec §13.15), never to gate whether a benefit pays out (that is driven by whether a covered event actually fired). Never sent to students. */
  internalClaimProbability: number
}

export type LifeEventDisclosureMode = 'ANNOUNCED' | 'PARTIALLY_ANNOUNCED' | 'HIDDEN'

/**
 * Spec §13.12: `disclosureMode` controls what students see BEFORE the
 * event fires (full announcement / partial hint / nothing). It is
 * deliberately independent of whether the event is deterministic or
 * probabilistic — `triggerProbability` (hidden, spec §13.15's "influence
 * strength shown to teachers instead of raw coefficients") drives when it
 * fires, `disclosureMode` drives what students are told about it in
 * advance. These are never conflated into one field.
 */
export interface LifeEventDefinition {
  id: string
  label: string
  disclosureMode: LifeEventDisclosureMode
  /** Hidden. Never sent to students in this raw form. */
  triggerProbability: number
  effectDescription: string
  /** One-time yen delta applied to the round's income when this event fires (e.g. 就職・昇進 positive, 失業 negative). 0 when the event has no direct income effect. */
  incomeEffectYen: number
  /** One-time yen delta applied to the round's expenses when this event fires (e.g. 出産・災害 positive, a windfall discount negative). 0 when none. */
  expenseEffectYen: number
  /** One-time yen delta applied directly to cash savings when this event fires (e.g. a lump-sum cost or gift, distinct from the recurring income/expense effects above). 0 when none. */
  cashEffectYen: number
}

export interface Liability {
  id: string
  kind: 'MORTGAGE' | 'OTHER_LOAN'
  principalYen: number
  remainingPrincipalYen: number
  annualInterestRatePercent: number
  remainingYears: number
}

/** Spec §13.1: standard is 5 years/round, 1 year/round is optional (§13.1). */
export type RoundYears = 1 | 5

/** Spec §13.3: lesson format — which mode students experience. */
export type CourseFormat = 'COMMON_CONDITIONS' | 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'

export interface EconomicFactors {
  /** Spec §13.11. Reflected into living expenses (annualCashFlow.ts, Task 3). */
  inflationPercent: number
  /** Spec §13.11. Reflected into deposits/borrowing. */
  interestRatePercent: number
  /** Spec §13.11. Baseline for assetReturn.ts (Task 4). */
  marketReturnPercent: number
}

/** Spec §13.16: which concepts are shown/hidden per teacher-selected goal focus. */
export type GoalPackage = 'EMERGENCY_FUND' | 'HOME_PURCHASE' | 'EDUCATION_FUND' | 'RETIREMENT_PREP' | 'RISK_DIVERSIFICATION' | 'INSURANCE_AND_PREPAREDNESS' | 'OVERALL_BALANCE'

export interface HomeEconomicsEvaluationWeights {
  lifeGoalAchievement: number
  emergencyFundAdequacy: number
  stability: number
  diversification: number
  borrowingBurden: number
  reflection: number
}

/** Spec §13.10. Eligibility is a simplified income-threshold check — "制度の完全再現を目的にしない". */
export interface PublicSupportProgram {
  id: string
  label: string
  /** Student-facing plain description of the condition (e.g. "世帯収入が400万円未満"). */
  conditionDescription: string
  /** null = no income restriction (always eligible on this axis). */
  maxHouseholdIncomeYen: number | null
  /** §13.10: "自動適用か申請選択かを教材で設定". */
  applicationMode: 'AUTOMATIC' | 'APPLICATION_REQUIRED'
  benefitAmountYen: number
}

/**
 * All spec §28-equivalent default values for home economics live here as
 * field defaults, not scattered across engine code (spec §30-10) — same
 * pattern as `SocialStudiesMarketContent` (Phase C Task2).
 */
export interface HomeEconomicsContent {
  households: HouseholdProfile[]
  assets: AssetPosition[]
  insuranceProducts: InsuranceProduct[]
  lifeEvents: LifeEventDefinition[]
  liabilities: Liability[]
  publicSupportPrograms: PublicSupportProgram[]
  /** §13.1. Default 5. */
  roundYears: RoundYears
  /** §13.3. */
  courseFormat: CourseFormat
  /** §13.8: "数値・式の版を教材版へ固定する" — this integer is the version tag templateValidation/annualCashFlow pin their tax/social-insurance formula to. Default 1. */
  taxAndSocialInsuranceModelVersion: number
  economicFactors: EconomicFactors
  /** §13.13: whether the template permits emergency borrowing at all — Task 8's `buildShortfallOptions` reads this. Default false. */
  borrowingAllowed: boolean
  /** §13.16. */
  goalPackage: GoalPackage
  /** §13.33-equivalent (§13.17). Must sum to 1; validated by `validateHomeEconomicsContent`. */
  evaluationWeights: HomeEconomicsEvaluationWeights
}
