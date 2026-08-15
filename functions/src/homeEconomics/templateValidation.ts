import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { distinctLifeStagesInOrder } from './householdAssignment'

export type ValidationResult = { valid: true } | { valid: false; errors: string[] }

export const validateHomeEconomicsContent = (content: HomeEconomicsContent): ValidationResult => {
  const errors: string[] = []

  if (content.households.length === 0) errors.push('担当プロフィールが1件も設定されていません。')

  if (content.courseFormat === 'COMMON_CONDITIONS' && content.households.length > 1) {
    errors.push('共通条件モードでは担当プロフィールを1件だけ設定してください。')
  }

  const idCounts = new Map<string, number>()
  for (const household of content.households) {
    idCounts.set(household.householdId, (idCounts.get(household.householdId) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) errors.push(`プロフィールIDが重複しています: ${id}`)
  }

  const assetTypeCounts = new Map<string, number>()
  for (const asset of content.assets) {
    assetTypeCounts.set(asset.assetType, (assetTypeCounts.get(asset.assetType) ?? 0) + 1)
  }
  for (const [assetType, count] of assetTypeCounts) {
    if (count > 1) errors.push(`資産カタログのassetTypeが重複しています: ${assetType}`)
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

/**
 * Advisory (non-blocking) warnings about a template's fit for its selected
 * `courseFormat`. Deliberately kept separate from
 * `validateHomeEconomicsContent()` above — these never affect save/publish
 * pass/fail semantics, they only surface a heads-up to the teacher when the
 * chosen advanced format won't actually produce any variation given the
 * current household profile set (e.g. ROLE_VARIANT with just one profile
 * behaves identically to COMMON_CONDITIONS).
 */
export const getHomeEconomicsContentWarnings = (content: HomeEconomicsContent): string[] => {
  const warnings: string[] = []

  if (content.courseFormat === 'ROLE_VARIANT' && content.households.length === 1) {
    warnings.push('役割ばらけモードですが担当プロフィールが1件のみのため、全チームが同じ条件になります。')
  }

  if (content.courseFormat === 'STAGE_SPLIT') {
    const stageCount = distinctLifeStagesInOrder(content.households).length
    if (stageCount === 1) {
      warnings.push('ライフステージ別モードですが異なるライフステージが1種類しかないため、ステージによる分岐が発生しません。')
    }
  }

  if (content.courseFormat === 'MULTI_PERSON_PER_TEAM' && content.households.length === 1) {
    warnings.push('複数人同時プレイモードですが担当プロフィールが1件のみのため、複数人で担当する意味がありません。')
  }

  return warnings
}
