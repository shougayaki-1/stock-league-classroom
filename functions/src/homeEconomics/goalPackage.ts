import type { GoalPackage } from '@stock-league/household-authoring-content'

export type ConceptCategory = 'INSURANCE' | 'HOUSING' | 'ASSET_DIVERSIFICATION' | 'RETIREMENT_PLANNING' | 'EMERGENCY_FUND' | 'EDUCATION_FUND' | 'RISK_MANAGEMENT'

const ALL_CONCEPTS: ConceptCategory[] = ['INSURANCE', 'HOUSING', 'ASSET_DIVERSIFICATION', 'RETIREMENT_PLANNING', 'EMERGENCY_FUND', 'EDUCATION_FUND', 'RISK_MANAGEMENT']

/**
 * Spec §13.16: "目的に関係しない概念を隠す" — this narrows what the UI
 * (Task 15) shows, never what the engine computes. A household with a
 * mortgage still has its mortgage serviced by settleRound (Task 11) even
 * when goalPackage is EMERGENCY_FUND and HOUSING isn't in the visible set
 * — only the display is filtered.
 */
export const resolveVisibleConcepts = (goalPackage: GoalPackage): ConceptCategory[] => {
  switch (goalPackage) {
    case 'EMERGENCY_FUND': return ['EMERGENCY_FUND', 'RISK_MANAGEMENT']
    case 'HOME_PURCHASE': return ['HOUSING', 'EMERGENCY_FUND']
    case 'EDUCATION_FUND': return ['EDUCATION_FUND', 'ASSET_DIVERSIFICATION']
    case 'RETIREMENT_PREP': return ['RETIREMENT_PLANNING', 'ASSET_DIVERSIFICATION']
    case 'RISK_DIVERSIFICATION': return ['ASSET_DIVERSIFICATION', 'RISK_MANAGEMENT']
    case 'INSURANCE_AND_PREPAREDNESS': return ['INSURANCE', 'RISK_MANAGEMENT', 'EMERGENCY_FUND']
    case 'OVERALL_BALANCE': return ALL_CONCEPTS
  }
}
