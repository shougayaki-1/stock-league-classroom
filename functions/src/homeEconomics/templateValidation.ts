import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'

export type ValidationResult = { valid: true } | { valid: false; errors: string[] }

export const validateHomeEconomicsContent = (content: HomeEconomicsContent): ValidationResult => {
  const errors: string[] = []

  if (content.households.length === 0) errors.push('担当プロフィールが1件も設定されていません。')

  const idCounts = new Map<string, number>()
  for (const household of content.households) {
    idCounts.set(household.householdId, (idCounts.get(household.householdId) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) errors.push(`プロフィールIDが重複しています: ${id}`)
  }

  const weights = content.evaluationWeights
  const weightSum = weights.lifeGoalAchievement + weights.emergencyFundAdequacy + weights.stability
    + weights.diversification + weights.borrowingBurden + weights.reflection
  if (Math.abs(weightSum - 1) > 0.001) errors.push('評価の重みの合計が1になっていません。')

  for (const event of content.lifeEvents) {
    if (event.triggerProbability < 0 || event.triggerProbability > 1) {
      errors.push(`イベント ${event.id} の発生確率は0〜1の範囲にしてください。`)
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
