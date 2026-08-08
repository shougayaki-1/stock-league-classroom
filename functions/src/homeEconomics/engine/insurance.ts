import type { InsuranceProduct } from '@stock-league/household-authoring-content'

export const computeAnnualPremiumTotal = (contracts: InsuranceProduct[]): number =>
  contracts.reduce((sum, contract) => sum + contract.premiumYenPerYear, 0)

export interface InsuranceBenefitResult {
  insuranceId: string
  paidYen: number
}

/**
 * Spec §13.6/§13.15: whether a benefit pays out is determined ENTIRELY by
 * whether one of `coveredEventIds` actually occurred this round
 * (`occurredEventIds`, from Task 7's life-event engine) — never by
 * `internalClaimProbability`, which is teacher-facing "influence
 * strength" display only and must not gate real payouts.
 */
export const computeInsuranceBenefits = (
  contracts: InsuranceProduct[],
  occurredEventIds: string[],
): InsuranceBenefitResult[] =>
  contracts.map((contract) => {
    const covered = contract.coveredEventIds.some((eventId) => occurredEventIds.includes(eventId))
    return { insuranceId: contract.id, paidYen: covered ? contract.benefitAmountYen : 0 }
  })
