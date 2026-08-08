import type { SocialStudiesEvaluationWeights } from '@stock-league/market-authoring-content'

export const computeOperationResultScore = (input: { finalAssetValue: number; startingCash: number }): number =>
  (input.finalAssetValue / input.startingCash) * 100

export const computePredictionAccuracyScore = (resolutions: { outcome: 'CORRECT' | 'INCORRECT' }[]): number | null => {
  if (resolutions.length === 0) return null
  const correct = resolutions.filter((r) => r.outcome === 'CORRECT').length
  return (correct / resolutions.length) * 100
}

export interface CriterionScores {
  operationResult: number | null
  predictionAccuracy: number | null
  informationUsage: number | null
  riskManagement: number | null
  reflection: number | null
}

/** Renormalizes weights across only the non-null criteria, so a team that
 * skipped predictions (矛盾解消F: excluded, not zeroed) is scored on the
 * remaining criteria's relative weight, not penalized for the gap. */
export const computeWeightedTotalScore = (
  scores: CriterionScores,
  weights: SocialStudiesEvaluationWeights,
): number | null => {
  const entries = (Object.keys(scores) as (keyof CriterionScores)[])
    .map((key) => ({ score: scores[key], weight: weights[key] }))
    .filter((e): e is { score: number; weight: number } => e.score !== null)
  if (entries.length === 0) return null
  const weightSum = entries.reduce((sum, e) => sum + e.weight, 0)
  const weightedSum = entries.reduce((sum, e) => sum + e.score * e.weight, 0)
  return weightedSum / weightSum
}

export const rankByCriterion = <T extends { teamId: string }>(
  teams: T[],
  criterion: keyof T,
): T[] =>
  teams
    .filter((t) => t[criterion] !== null && t[criterion] !== undefined)
    .sort((a, b) => (b[criterion] as unknown as number) - (a[criterion] as unknown as number))
