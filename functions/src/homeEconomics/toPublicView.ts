import type { AssetPositionPublicView, HouseholdProfilePublicView, InsuranceContractPublicView } from '@stock-league/household-public-content'
import type { AssetPosition, HouseholdProfile, InsuranceProduct } from '@stock-league/household-authoring-content'

/**
 * The sole place that decides what students may see about their household
 * profile, assets, and insurance. Fixed here (server-side, Functions)
 * rather than as an import-boundary rule — see
 * `functions/src/market/toPublicView.ts` (Phase C Task1) for the
 * identical architecture note. Every field is listed explicitly
 * (allow-list) — never `{...source}` — so a future field added to the
 * authoring type is excluded by default.
 */
export const toHouseholdProfilePublicView = (profile: HouseholdProfile): HouseholdProfilePublicView => ({
  householdId: profile.householdId, age: profile.age,
  householdIncomeYen: profile.householdIncomeYen,
  annualLivingExpensesYen: profile.annualLivingExpensesYen,
  cashSavingsYen: profile.cashSavingsYen,
  family: profile.family, housing: profile.housing,
  lifeGoal: profile.lifeGoal, lifeStage: profile.lifeStage,
  isFictional: true,
})

export const toAssetPositionsPublicView = (assets: AssetPosition[]): AssetPositionPublicView[] =>
  assets.map((asset) => ({ assetType: asset.assetType, valueYen: asset.valueYen }))

export const toInsuranceContractsPublicView = (contracts: InsuranceProduct[]): InsuranceContractPublicView[] =>
  contracts.map((contract) => ({
    id: contract.id, productName: contract.productName,
    premiumYenPerYear: contract.premiumYenPerYear, coveredRisk: contract.coveredRisk,
    benefitDescription: contract.benefitDescription, contractYearsRemaining: contract.contractYears,
  }))
