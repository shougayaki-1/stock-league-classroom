import type { AssetPosition, HouseholdProfile, InsuranceProduct, LifeEventDefinition, Liability, PublicSupportProgram } from '@stock-league/household-authoring-content'
import type { HouseholdState } from '../../lessonRuns/households/repository'
import type { HouseholdDecisionInput } from '../submitDecision'
import { applyEventEffects, determineOccurredEvents } from './lifeEvents'
import { computeAnnualCashFlow } from './annualCashFlow'
import { computeTaxAndSocialInsurance } from './taxAndSocialInsurance'
import { computeAnnualPremiumTotal, computeInsuranceBenefits } from './insurance'
import { applyMortgageRound } from './mortgage'
import { computeAssetReturn } from './assetReturn'
import { applyShortfallResolution, buildShortfallOptions, detectShortfall } from './shortfallOptions'
import { computePublicSupportAvailableYen, determineEligiblePrograms } from './publicSupport'

export interface SettleRoundInput {
  household: HouseholdState
  profile: HouseholdProfile
  decision: HouseholdDecisionInput | null
  lifeEvents: LifeEventDefinition[]
  insuranceProducts: InsuranceProduct[]
  publicSupportPrograms: PublicSupportProgram[]
  liabilityCatalog: Liability[]
  /**
   * Task 1's authoring asset catalog (`HomeEconomicsContent.assets`),
   * resolved by `assetType`. `settleRound` stays a pure function of
   * whatever it's given — `processRound.ts` is responsible for indexing
   * the template snapshot's `assets` array and forwarding it here (Step 4
   * of this task's brief) so `computeAssetReturn` below uses the real
   * teacher-authored `expectedReturnPercent`/`volatilityPercent`, not a
   * placeholder.
   */
  assetCatalog: AssetPosition[]
  economicFactors: { inflationPercent: number; interestRatePercent: number; marketReturnPercent: number }
  taxModelVersion: number
  roundYears: number
  borrowingAllowed: boolean
  randomSeed: string
  restoreGeneration: number
}
export interface SettleRoundResult {
  newHouseholdState: HouseholdState
  occurredEventIds: string[]
  incomeYen: number
  expensesYen: number
  netCashFlowYen: number
  shortfallYen: number
  insuranceBenefitsYen: number
}

export const settleRound = (input: SettleRoundInput): SettleRoundResult => {
  const { household, profile } = input

  // 1. Life events (spec §13.12)
  const occurredEventIds = determineOccurredEvents({
    events: input.lifeEvents, eventProbabilityOverrides: profile.eventProbabilityOverrides,
    householdId: household.householdId, roundIndex: household.roundIndex,
    randomSeed: input.randomSeed, restoreGeneration: input.restoreGeneration,
  })
  const eventEffects = applyEventEffects(input.lifeEvents, occurredEventIds)

  // 2. Income + tax (spec §13.7/§13.8)
  const grossIncomeYen = profile.householdIncomeYen + eventEffects.incomeEffectYen
  const taxResult = computeTaxAndSocialInsurance({ grossIncomeYen }, input.taxModelVersion)

  // 3. Mortgage payments (spec §13.9) — all active MORTGAGE liabilities, this round's roundYears advanced together.
  const newLiabilities: HouseholdState['activeLiabilities'] = {}
  let mortgagePaymentTotalYen = 0
  for (const [liabilityId, state] of Object.entries(household.activeLiabilities)) {
    const catalogEntry = input.liabilityCatalog.find((l) => l.id === liabilityId)
    if (!catalogEntry || catalogEntry.kind !== 'MORTGAGE' || state.remainingPrincipalYen <= 0) {
      newLiabilities[liabilityId] = state
      continue
    }
    const roundResult = applyMortgageRound({
      remainingPrincipalYen: state.remainingPrincipalYen, annualInterestRatePercent: state.annualInterestRatePercent,
      remainingYears: state.remainingYears, roundYears: input.roundYears,
    })
    mortgagePaymentTotalYen += roundResult.totalPaymentYen
    newLiabilities[liabilityId] = {
      remainingPrincipalYen: roundResult.newRemainingPrincipalYen, remainingYears: roundResult.newRemainingYears,
      annualInterestRatePercent: state.annualInterestRatePercent,
    }
  }

  // 4. Insurance premiums + benefits (spec §13.6)
  const activeProducts = Object.keys(household.activeInsuranceContracts)
    .map((id) => input.insuranceProducts.find((product) => product.id === id))
    .filter((product): product is InsuranceProduct => product !== undefined)
  const insurancePremiumYen = computeAnnualPremiumTotal(activeProducts)
  const insuranceBenefitsYen = computeInsuranceBenefits(activeProducts, occurredEventIds)
    .reduce((sum, benefit) => sum + benefit.paidYen, 0)

  // 5. Cash flow (spec §13.7): fixed = contractual obligations, variable = living costs (inflation-adjusted).
  const cashFlowResult = computeAnnualCashFlow({
    netIncomeYen: taxResult.netIncomeYen,
    fixedExpensesYen: mortgagePaymentTotalYen + insurancePremiumYen,
    variableExpensesYen: Math.max(0, profile.annualLivingExpensesYen + eventEffects.expenseEffectYen),
    inflationPercent: input.economicFactors.inflationPercent,
  })
  const netCashFlowYen = cashFlowResult.netCashFlowYen + eventEffects.cashEffectYen + insuranceBenefitsYen

  // 6. Shortfall detection + resolution (spec §13.13) — never auto-bankrupts.
  const shortfallYen = detectShortfall({ cashSavingsYen: household.cashYen, netCashFlowYen })
  let resolutionCashDeltaYen = 0
  let newLiabilityFromShortfallYen = 0
  let goalDelayedRoundsDelta = 0
  if (shortfallYen > 0) {
    const eligiblePrograms = determineEligiblePrograms(input.publicSupportPrograms, grossIncomeYen)
    const publicSupportAvailableYen = computePublicSupportAvailableYen(eligiblePrograms, input.decision?.publicSupportApplicationIds ?? [])
    const options = buildShortfallOptions({
      shortfallYen, liquidAssetsYen: Object.values(household.assetHoldingsYen).reduce((sum, v) => sum + v, 0),
      publicSupportAvailableYen, borrowingAllowed: input.borrowingAllowed,
    })
    const chosenType = input.decision?.shortfallResolutionType ?? 'REDUCE_EXPENSES'
    const chosenOption = options.find((option) => option.type === chosenType) ?? options[0]
    const resolution = applyShortfallResolution(chosenOption, shortfallYen)
    resolutionCashDeltaYen = resolution.cashDeltaYen
    newLiabilityFromShortfallYen = resolution.newLiabilityYen
    goalDelayedRoundsDelta = resolution.goalDelayedRounds
  }

  // 7. Asset allocation changes (from decision) + asset returns (spec §13.5/§13.15).
  const newAssetHoldingsYen: Record<string, number> = { ...household.assetHoldingsYen }
  for (const [assetType, deltaYen] of Object.entries(input.decision?.assetAllocationChangesYen ?? {})) {
    newAssetHoldingsYen[assetType] = Math.max(0, (newAssetHoldingsYen[assetType] ?? 0) + deltaYen)
  }
  for (const assetType of Object.keys(newAssetHoldingsYen)) {
    // Step 4 fix: expectedReturnPercent/volatilityPercent per asset type
    // come from the template's authoring `assets` catalog (Task 1),
    // resolved by `processRound.ts` and forwarded here as
    // `input.assetCatalog`, matched by `assetType`. This composition
    // assumes at most one authoring entry per assetType per household; a
    // template with multiple products of the same assetType needs a
    // richer key than assetType alone — deferred, see Task 17's
    // completion-condition review. A holding whose assetType has no
    // matching catalog entry (e.g. a legacy/unknown assetType) falls back
    // to 0/0 (no return, no risk) rather than throwing, so a partial or
    // stale catalog never crashes settlement.
    const catalogEntry = input.assetCatalog.find((a) => a.assetType === assetType)
    const returnResult = computeAssetReturn({
      assetType: assetType as never, valueYen: newAssetHoldingsYen[assetType],
      expectedReturnPercent: catalogEntry?.expectedReturnPercent ?? 0,
      volatilityPercent: catalogEntry?.volatilityPercent ?? 0,
      marketReturnPercent: input.economicFactors.marketReturnPercent,
      householdId: household.householdId, roundIndex: household.roundIndex,
      randomSeed: input.randomSeed, restoreGeneration: input.restoreGeneration,
    })
    newAssetHoldingsYen[assetType] = returnResult.nextValueYen
  }

  const newCashYen = Math.max(0, household.cashYen + netCashFlowYen + resolutionCashDeltaYen)
  if (newLiabilityFromShortfallYen > 0) {
    newLiabilities[`shortfall-loan-round-${household.roundIndex}`] = {
      remainingPrincipalYen: newLiabilityFromShortfallYen, remainingYears: 5, annualInterestRatePercent: 3,
    }
  }

  return {
    newHouseholdState: {
      ...household, cashYen: newCashYen, assetHoldingsYen: newAssetHoldingsYen, activeLiabilities: newLiabilities,
      roundIndex: household.roundIndex + 1, goalDelayedRounds: household.goalDelayedRounds + goalDelayedRoundsDelta,
      updatedAtServerMillis: household.updatedAtServerMillis,
    },
    occurredEventIds, incomeYen: taxResult.netIncomeYen, expensesYen: cashFlowResult.totalExpensesYen,
    netCashFlowYen, shortfallYen, insuranceBenefitsYen,
  }
}
