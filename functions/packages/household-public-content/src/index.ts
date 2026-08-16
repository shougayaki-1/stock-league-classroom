export type LifeStage = 'STUDENT' | 'INDEPENDENT' | 'FAMILY_FORMATION' | 'CHILD_REARING' | 'PRE_RETIREMENT' | 'RETIRED'

/**
 * Student-facing profile view (spec §13.4's 7 core fields). `isFictional`
 * must always be `true` and is rendered in the UI as "これは授業用の架空
 * プロフィールです" (spec §13.4) — never a real student's own data.
 */
export interface HouseholdProfilePublicView {
  householdId: string
  age: number
  householdIncomeYen: number
  annualLivingExpensesYen: number
  cashSavingsYen: number
  family: string
  housing: string
  lifeGoal: string
  lifeStage: LifeStage
  isFictional: true
}

export type AssetType = 'CASH' | 'SAVINGS_DEPOSIT' | 'BOND' | 'DOMESTIC_STOCK' | 'FOREIGN_STOCK' | 'INVESTMENT_TRUST'

/** Never carries expected-return/volatility coefficients — those are authoring-only (spec §13.15 "教師には計算式より影響の強さを見せる"). */
export interface AssetPositionPublicView {
  assetType: AssetType
  valueYen: number
}

/**
 * Spec §13.6: insurance is deliberately NOT part of the asset-allocation
 * pie chart — kept as a fully separate type from AssetPositionPublicView,
 * never merged into the same array or UI component.
 */
export interface InsuranceContractPublicView {
  id: string
  productName: string
  premiumYenPerYear: number
  coveredRisk: string
  benefitDescription: string
  contractYearsRemaining: number
}

export interface LiabilityPublicView {
  id: string
  kind: 'MORTGAGE' | 'OTHER_LOAN'
  remainingPrincipalYen: number
  annualInterestRatePercent: number
  remainingYears: number
}

/**
 * Hand-synced with `functions/src/homeEconomics/householdAssignment.ts`'s
 * `AdvancedHouseholdCourseFormat` — duplicated here rather than imported
 * because this package has no dependency edge onto `functions/src` (only
 * `@stock-league/household-authoring-content` depends on THIS package, never
 * the other way around). Same hand-sync discipline `src/lib/lessonRuns/
 * liveTypes.ts` documents for its own cross-boundary duplicates.
 */
export type AdvancedHouseholdCourseFormat = 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'

/**
 * Task 12 (household final comparison): one household's row within the
 * class-wide, privacy-safe comparison published the moment an advanced
 * lesson enters REFLECTION. `profileId` is the LOGICAL template profile id
 * (`HouseholdProfile.householdId`) — the opaque per-team RUNTIME
 * `HouseholdAssignmentEntry.householdId` never appears anywhere in this
 * view, nor does any participant/student identity. `profile` is built
 * exclusively through `toHouseholdProfilePublicView()` (never a spread of
 * the internal `HouseholdProfile`, so `internalRiskFactors`/
 * `eventProbabilityOverrides` can never leak in). No claim-probability or
 * random-seed field belongs on this type either.
 */
export interface HouseholdClassComparisonHouseholdView {
  profileId: string
  profile: HouseholdProfilePublicView
  cashYen: number
  totalAssetsYen: number
  totalLiabilitiesYen: number
  goalDelayedRounds: number
  lifeGoalAchievementScore: number
}

export interface HouseholdClassComparisonTeamView {
  teamDisplayName: string
  households: HouseholdClassComparisonHouseholdView[]
}

/** Persisted at `lessonRuns/{lessonRunId}/householdFinalComparison/result` and mirrored onto the shared `lessonRunPublic/{lessonRunId}` RTDB node's `householdClassComparison` field the moment RUNNING transitions to REFLECTION. */
export interface HouseholdClassComparisonPublicView {
  courseFormat: AdvancedHouseholdCourseFormat
  /** The class-wide synchronized round count (`HouseholdRuntimeControl.synchronizedRoundIndex`) at REFLECTION time — NOT any individual household's own `roundIndex` (the REFLECTION gate requires every household to be aligned on this same value before publication, so the two would be equal anyway, but this field is explicitly the class-wide one). */
  finalRoundCount: number
  publishedAtMillis: number
  teams: HouseholdClassComparisonTeamView[]
}
