import type { HomeEconomicsEvaluationWeights } from '@stock-league/household-authoring-content'

/** PROVISIONAL — spec §13.17 requires "緊急予備資金" as a criterion without specifying the months-of-expenses threshold; 6 months is a common financial-literacy rule of thumb, to be tuned during pilot runs (Task 17). */
const EMERGENCY_FUND_TARGET_MONTHS = 6

export const computeEmergencyFundAdequacyScore = (input: { cashYen: number; annualLivingExpensesYen: number }): number => {
  if (input.annualLivingExpensesYen === 0) return 100
  const monthsCovered = (input.cashYen / input.annualLivingExpensesYen) * 12
  return Math.min(100, Math.round((monthsCovered / EMERGENCY_FUND_TARGET_MONTHS) * 100))
}

/**
 * PROVISIONAL — a simple normalized count of distinct held asset types
 * (0 types = 0, 1 type = low, 4+ types = 100), not a variance-weighted
 * Herfindahl index. Chosen for classroom legibility over statistical
 * precision; revisit during pilot runs (Task 17).
 */
export const computeDiversificationScore = (assetHoldingsYen: Record<string, number>): number => {
  const heldTypeCount = Object.values(assetHoldingsYen).filter((v) => v > 0).length
  return Math.min(100, Math.round((heldTypeCount / 4) * 100))
}

export const computeBorrowingBurdenScore = (input: { annualDebtServiceYen: number; netIncomeYen: number }): number => {
  if (input.netIncomeYen === 0) return input.annualDebtServiceYen === 0 ? 100 : 0
  const burdenRatio = input.annualDebtServiceYen / input.netIncomeYen
  return Math.max(0, Math.round(100 - burdenRatio * 200))
}

export const computeStabilityScore = (input: { shortfallRoundCount: number; totalRounds: number }): number => {
  if (input.totalRounds === 0) return 100
  return Math.round(((input.totalRounds - input.shortfallRoundCount) / input.totalRounds) * 100)
}

export const computeLifeGoalAchievementScore = (input: { goalDelayedRounds: number; totalRounds: number }): number => {
  if (input.totalRounds === 0) return 100
  return Math.max(0, Math.round(100 - (input.goalDelayedRounds / input.totalRounds) * 100))
}

export interface HomeEconomicsCriterionScores {
  lifeGoalAchievement: number | null
  emergencyFundAdequacy: number | null
  stability: number | null
  diversification: number | null
  borrowingBurden: number | null
  /** Rubric-graded by the teacher (spec §13.17: "根拠の妥当性を自動採点しない") — null until entered. */
  reflection: number | null
}

/** Same null-renormalization discipline as Phase C Task 16's `computeWeightedTotalScore`. */
export const computeWeightedTotalScore = (
  scores: HomeEconomicsCriterionScores,
  weights: HomeEconomicsEvaluationWeights,
): number | null => {
  const entries = (Object.keys(scores) as (keyof HomeEconomicsCriterionScores)[])
    .map((key) => ({ score: scores[key], weight: weights[key] }))
    .filter((e): e is { score: number; weight: number } => e.score !== null)
  if (entries.length === 0) return null
  const weightSum = entries.reduce((sum, e) => sum + e.weight, 0)
  const weightedSum = entries.reduce((sum, e) => sum + e.score * e.weight, 0)
  return weightedSum / weightSum
}

export const rankByCriterion = <T extends { householdId: string }>(households: T[], criterion: keyof T): T[] =>
  households
    .filter((h) => h[criterion] !== null && h[criterion] !== undefined)
    .sort((a, b) => (b[criterion] as unknown as number) - (a[criterion] as unknown as number))
