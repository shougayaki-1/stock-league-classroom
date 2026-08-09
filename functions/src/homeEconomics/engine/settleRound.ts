import type { AssetPosition, HouseholdProfile, InsuranceProduct, LifeEventDefinition, Liability, PublicSupportProgram } from '@stock-league/household-authoring-content'
import type { HouseholdState } from '../../lessonRuns/households/repository'
import type { HouseholdDecisionInput } from '../submitDecision'
import { applyEventEffects, determineOccurredEvents } from './lifeEvents'
import { computeAnnualCashFlow } from './annualCashFlow'
import { computeTaxAndSocialInsurance } from './taxAndSocialInsurance'
import { computeAnnualPremiumTotal, computeInsuranceBenefits } from './insurance'
import { applyMortgageRound } from './mortgage'
import { computeAssetReturn } from './assetReturn'
import { applyShortfallResolution, buildShortfallOptions, detectShortfall, type ShortfallOption } from './shortfallOptions'
import { computePublicSupportAvailableYen, determineEligiblePrograms } from './publicSupport'
import { computeSimplifiedPensionBenefit, computeVoluntaryAssetDrawdown, PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT } from './retirement'

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
  /**
   * Fix (Important I2, Task 15 review): the ACTUAL shortfall options this
   * settlement considered — built from the SAME pre-settlement inputs
   * `settleRound` itself used (pre-settlement `household.assetHoldingsYen`,
   * post-life-event `grossIncomeYen` for public-support eligibility), not
   * an approximation recomputed later from post-settlement state. Always
   * `[]` when `shortfallYen === 0` — there is nothing to resolve, so
   * nothing was considered. `processRound.ts`'s RTDB broadcast forwards
   * this array as-is rather than recomputing it (which previously drifted:
   * post-sale asset holdings and pre-life-event income gave a
   * different-looking, sometimes wrong, set of options).
   */
  shortfallOptionsConsidered: ShortfallOption[]
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

  // 2. Income + tax (spec §13.7/§13.8/§13.14)
  //
  // Task 11/12 integration gap (found in Task 17): Task 12's own `Consumes`
  // line contracts that this round-settlement process calls the retirement
  // engine "only when `lifeStage === 'RETIRED'`" — that call never
  // existed until now. `household.lifeStage` (not `profile.lifeStage`) is
  // the source of truth here: it's the per-household field that actually
  // persists and carries forward round-to-round in `HouseholdState`
  // (`profile.lifeStage` is a static snapshot from the template, never
  // updated after lessonRun creation). Nothing in this engine transitions
  // `lifeStage` today (age never advances either — see Task 17's
  // completion-condition review), so the only way a household reaches
  // RETIRED is a template/checkpoint that pre-seeds
  // `startingLifeStage: 'RETIRED'`; this fix's scope is making settleRound
  // correctly HANDLE that state, not building a new aging-transition
  // subsystem (out of scope for the contracted gap — see this task's
  // report for the full reasoning).
  //
  // A retired household is no longer earning `profile.householdIncomeYen`
  // (its pre-retirement salary) — spec §13.14's "収入減少" (income
  // reduction) — so `grossIncomeYen` is replaced with a pension benefit
  // derived from that same pre-retirement figure via
  // `computeSimplifiedPensionBenefit` (Task 12), using the single
  // documented default replacement rate (no per-template override field
  // exists on `HomeEconomicsContent`/`HouseholdProfile` today). Life-event
  // income effects (§13.12) still apply on top, same as the non-retired
  // path — a life event reducing income is just as meaningful against a
  // pension as against a salary.
  const isRetired = household.lifeStage === 'RETIRED'
  const baseIncomeYen = isRetired
    ? computeSimplifiedPensionBenefit({
      preRetirementIncomeYen: profile.householdIncomeYen,
      pensionReplacementRatePercent: PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT,
    })
    : profile.householdIncomeYen
  const grossIncomeYen = baseIncomeYen + eventEffects.incomeEffectYen
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

  // 4. Insurance purchases/cancellations (from decision) + premiums + benefits (spec §13.6).
  //
  // Fix (Important #2): `insurancePurchaseIds`/`insuranceCancelIds` were
  // previously read into `HouseholdDecisionInput` but never applied —
  // `settleRound` only looked at `household.activeInsuranceContracts`
  // (pre-existing contracts) and passed it through unchanged, so a student
  // who bought insurance never actually got the contract or paid its
  // premium. The mutated set below (`newActiveInsuranceContracts`) is now
  // both (a) what feeds this round's premium/benefit computation and (b)
  // what's written to `newHouseholdState`, so a newly-purchased policy's
  // premium is charged — and its benefit payable — starting THIS round,
  // and a cancelled policy stops costing/covering THIS round. This is a
  // deliberate choice among two reasonable readings of the brief (charge
  // starting this round vs. next round): life events for this round are
  // already determined in Step 1 above from `randomSeed`/`roundIndex`
  // alone, independent of the decision, so there is no way for a student
  // to "buy insurance after seeing this round's event" — same-round
  // application carries no fairness/gaming risk and gives the most
  // immediate, legible feedback loop for the lesson. Cancel is applied
  // before purchase so that if the same id somehow appears in both lists,
  // the purchase (the more specific, final intent) wins.
  const newActiveInsuranceContracts: HouseholdState['activeInsuranceContracts'] = { ...household.activeInsuranceContracts }
  for (const cancelId of input.decision?.insuranceCancelIds ?? []) {
    delete newActiveInsuranceContracts[cancelId]
  }
  for (const purchaseId of input.decision?.insurancePurchaseIds ?? []) {
    const product = input.insuranceProducts.find((p) => p.id === purchaseId)
    if (product) newActiveInsuranceContracts[purchaseId] = product.contractYears
  }
  const activeProducts = Object.keys(newActiveInsuranceContracts)
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
  let resolutionAssetDeltaYen = 0
  let newLiabilityFromShortfallYen = 0
  let goalDelayedRoundsDelta = 0
  let shortfallOptionsConsidered: ShortfallOption[] = []
  if (shortfallYen > 0) {
    const eligiblePrograms = determineEligiblePrograms(input.publicSupportPrograms, grossIncomeYen)
    const publicSupportAvailableYen = computePublicSupportAvailableYen(eligiblePrograms, input.decision?.publicSupportApplicationIds ?? [])
    const options = buildShortfallOptions({
      // Total across ALL asset types — this only gates whether SELL_ASSETS
      // appears as an option at all ("does the household hold *any*
      // liquid assets") and is deliberately NOT what sizes how much
      // SELL_ASSETS can actually resolve; see the N1 fix immediately
      // below for that.
      shortfallYen, liquidAssetsYen: Object.values(household.assetHoldingsYen).reduce((sum, v) => sum + v, 0),
      publicSupportAvailableYen, borrowingAllowed: input.borrowingAllowed,
    })
    shortfallOptionsConsidered = options
    const chosenType = input.decision?.shortfallResolutionType ?? 'REDUCE_EXPENSES'
    let chosenOption = options.find((option) => option.type === chosenType) ?? options[0]

    // Fix round 3 (Critical N1 + Important N2): `buildShortfallOptions`
    // above sizes SELL_ASSETS's `resolvesYen` off the household's TOTAL
    // liquid assets across every asset type, but the decision names only
    // ONE specific asset type to actually sell from
    // (`shortfallResolutionAssetType`) — a household with 1,000,000 in
    // DOMESTIC_STOCK and 4,000,000 in FOREIGN_STOCK would have
    // `resolvesYen` sized off the 5,000,000 total even though selling
    // DOMESTIC_STOCK alone can only ever raise 1,000,000. That mismatch is
    // exactly what let the later `Math.max(0, ...)` asset-debit floor
    // (below, §7a) silently swallow the shortfall between what was
    // actually debited from the named asset and what was credited to
    // cash — fabricating money. The fix: once SELL_ASSETS is the chosen
    // option, re-cap its `resolvesYen` to the NAMED asset's own holding
    // (N1). If no valid asset type is named (or it doesn't correspond to
    // a holding the household actually has — N2, defensive: unreachable
    // through the Callable today, which requires
    // `shortfallResolutionAssetType` for SELL_ASSETS, but `settleRound` is
    // a pure engine callable independently), there is nothing to sell
    // against at all, so SELL_ASSETS must not be applied — fall back to
    // REDUCE_EXPENSES (always present in `options`, see
    // `buildShortfallOptions`) rather than crediting cash with no
    // offsetting asset debit.
    if (chosenOption.type === 'SELL_ASSETS') {
      const namedAssetType = input.decision?.shortfallResolutionAssetType
      const namedAssetHoldingYen = namedAssetType ? (household.assetHoldingsYen[namedAssetType] ?? 0) : 0
      chosenOption = namedAssetHoldingYen > 0
        ? { ...chosenOption, resolvesYen: Math.min(chosenOption.resolvesYen, namedAssetHoldingYen) }
        : (options.find((option) => option.type === 'REDUCE_EXPENSES') ?? options[0])
    }
    const resolution = applyShortfallResolution(chosenOption, shortfallYen)
    resolutionCashDeltaYen = resolution.cashDeltaYen
    resolutionAssetDeltaYen = resolution.assetDeltaYen
    newLiabilityFromShortfallYen = resolution.newLiabilityYen
    goalDelayedRoundsDelta = resolution.goalDelayedRounds

    // Important #1 fix: SELL_ASSETS/PUBLIC_SUPPORT are capped at
    // `min(shortfallYen, available)`, and DELAY_GOAL adds 0 cash at all —
    // so `resolutionCashDeltaYen` can land short of `shortfallYen`. The
    // previous code fed that shortfall straight into `Math.max(0, ...)` on
    // the final cash figure, which silently forgave the residual as free
    // money instead of surfacing it. Per spec §13.13 ("never
    // auto-bankrupts, but never silently profits either"), any residual
    // not covered by the chosen resolution is closed the same way an
    // unresolved shortfall is closed by default: REDUCE_EXPENSES, which
    // always fully resolves. This guarantees
    // `household.cashYen + netCashFlowYen + resolutionCashDeltaYen` is
    // always exactly >= 0 by construction below, so the earlier
    // `Math.max(0, ...)` clamp is no longer load-bearing and is removed.
    const residualYen = shortfallYen - resolutionCashDeltaYen
    if (residualYen > 0) resolutionCashDeltaYen += residualYen
  }

  // 7. Shortfall-resolution asset sale, decision-driven reallocation, then asset returns (spec §13.5/§13.15).
  const newAssetHoldingsYen: Record<string, number> = { ...household.assetHoldingsYen }

  // 7a. Critical #1 fix: SELL_ASSETS resolves the shortfall by moving value
  // OUT of a specific asset INTO cash (`shortfallOptions.ts`'s
  // `applyShortfallResolution` already returns `assetDeltaYen` for this),
  // but this was never applied to `newAssetHoldingsYen` — cash gained the
  // sale proceeds while the sold asset's holding stayed untouched, so the
  // "sold" value kept earning this round's return on top of having already
  // been spent. Must happen BEFORE the returns loop below (the sold-off
  // portion must not earn this round's return).
  //
  // Fix round 3 (N1): `resolutionAssetDeltaYen` is now capped, at the
  // point SELL_ASSETS is chosen (§6 above), by the NAMED asset's own
  // holding — not the household's total liquid assets across every asset
  // type. That means `(newAssetHoldingsYen[soldAssetType] ?? 0) +
  // resolutionAssetDeltaYen` can no longer go negative here, so the
  // `Math.max(0, ...)` floor below should be genuinely unreachable now.
  // It's left in place as a defensive safety net (harmless once
  // unreachable) rather than removed.
  if (resolutionAssetDeltaYen !== 0 && input.decision?.shortfallResolutionAssetType) {
    const soldAssetType = input.decision.shortfallResolutionAssetType
    newAssetHoldingsYen[soldAssetType] = Math.max(0, (newAssetHoldingsYen[soldAssetType] ?? 0) + resolutionAssetDeltaYen)
  }

  // 7a-2. Voluntary asset drawdown (spec §13.14) — RETIRED households only.
  // Deliberately distinct from the SELL_ASSETS shortfall resolution above:
  // this is the household's DISCRETIONARY choice to raise its living
  // standard by converting held assets to spendable cash, per Task 12's own
  // framing ("強制売却ではなく、生活水準を上げるための自発的な取り崩し" —
  // not a forced sale, a deliberate choice), so it is driven by a decision
  // field (`voluntaryDrawdownRequestedYen`), never by shortfall detection,
  // and applies proportionally across ALL held asset types (Task 12's
  // `computeVoluntaryAssetDrawdown`) rather than one named type. Runs AFTER
  // the shortfall sale (so it draws down from post-shortfall-sale holdings,
  // never double-counting the same yen) and BEFORE the returns loop (so the
  // withdrawn portion does not earn this round's return, same reasoning as
  // 7a above). Guarded on `isRetired` at the engine level — even if a
  // decision somehow carries this field for a non-retired household (the
  // Callable does not gate on lifeStage since it has no household context
  // at validation time), `settleRound` itself never applies it outside
  // retirement, which is the actual authorization boundary spec §13.14
  // describes.
  // Defense-in-depth: `settleRound` is a standalone pure engine function
  // that could theoretically be called directly, bypassing the Callable's
  // `isValidOptionalNonNegativeNumber` integer check (`onCall.ts`). Floor
  // and clamp here so a malformed/fractional value never reaches
  // `computeVoluntaryAssetDrawdown`, whose whole-yen-per-step remainder
  // logic would otherwise destroy the fractional part of the requested
  // amount instead of simply dropping it.
  let drawdownWithdrawnYen = 0
  const requestedDrawdownYen = Math.floor(Math.max(0, input.decision?.voluntaryDrawdownRequestedYen ?? 0))
  if (isRetired && requestedDrawdownYen > 0) {
    const drawdownResult = computeVoluntaryAssetDrawdown({
      requestedYen: requestedDrawdownYen, assetHoldingsYen: newAssetHoldingsYen,
    })
    drawdownWithdrawnYen = drawdownResult.withdrawnYen
    Object.assign(newAssetHoldingsYen, drawdownResult.newAssetHoldingsYen)
  }

  // 7b. Critical #2 fix: `assetAllocationChangesYen` is documented
  // (`submitDecision.ts`) as "funded from cash" — a positive delta moves
  // cash INTO an asset, a negative delta moves value OUT of an asset back
  // INTO cash. The previous code only ever mutated `newAssetHoldingsYen`;
  // neither `household.cashYen` nor `newCashYen` were ever debited/
  // credited, so a positive allocation fabricated asset value from
  // nothing (and a negative one destroyed it without returning cash).
  //
  // `preAllocationCashYen` is the household's cash position after this
  // round's income/expenses and (now fully-resolved, see 6 above)
  // shortfall resolution, but BEFORE any decision-driven reallocation —
  // i.e. the cash actually available to fund a purchase into an asset.
  // Since a pure engine function must never fail/throw (this codebase's
  // "never auto-bankrupts" pattern for engines), an unaffordable positive
  // allocation is CAPPED at what's actually available rather than
  // rejected — money is neither created nor destroyed, the student's
  // over-ambitious request is just partially honored. Symmetrically, a
  // negative allocation (selling into cash) is capped at the asset's
  // current holding — you cannot sell more of an asset than you own.
  // Entries are applied in the decision object's own key order,
  // sequentially decrementing/crediting available cash as they go, so
  // multiple allocations in one submission compete for the same
  // available-cash pool in a deterministic (insertion-order) way.
  const preAllocationCashYen = household.cashYen + netCashFlowYen + resolutionCashDeltaYen + drawdownWithdrawnYen
  let availableCashForAllocationYen = preAllocationCashYen
  for (const [assetType, requestedDeltaYen] of Object.entries(input.decision?.assetAllocationChangesYen ?? {})) {
    const currentHoldingYen = newAssetHoldingsYen[assetType] ?? 0
    let appliedDeltaYen = requestedDeltaYen
    if (appliedDeltaYen > 0) {
      appliedDeltaYen = Math.min(appliedDeltaYen, availableCashForAllocationYen)
    } else if (appliedDeltaYen < 0) {
      appliedDeltaYen = Math.max(appliedDeltaYen, -currentHoldingYen)
    }
    newAssetHoldingsYen[assetType] = currentHoldingYen + appliedDeltaYen
    availableCashForAllocationYen -= appliedDeltaYen
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

  // `availableCashForAllocationYen` already IS the final cash figure: it
  // started at `preAllocationCashYen` (guaranteed >= 0 by the Important #1
  // fix above) and was only ever decremented by a capped-affordable
  // positive allocation or credited by a capped-sane negative one, so it
  // can never go negative. No `Math.max(0, ...)` floor needed here — see
  // the Important #1 fix's comment for why that floor was removed instead
  // of reapplied.
  const newCashYen = availableCashForAllocationYen
  if (newLiabilityFromShortfallYen > 0) {
    newLiabilities[`shortfall-loan-round-${household.roundIndex}`] = {
      remainingPrincipalYen: newLiabilityFromShortfallYen, remainingYears: 5, annualInterestRatePercent: 3,
    }
  }

  return {
    newHouseholdState: {
      ...household, cashYen: newCashYen, assetHoldingsYen: newAssetHoldingsYen, activeLiabilities: newLiabilities,
      activeInsuranceContracts: newActiveInsuranceContracts,
      roundIndex: household.roundIndex + 1, goalDelayedRounds: household.goalDelayedRounds + goalDelayedRoundsDelta,
      updatedAtServerMillis: household.updatedAtServerMillis,
    },
    occurredEventIds, incomeYen: taxResult.netIncomeYen, expensesYen: cashFlowResult.totalExpensesYen,
    netCashFlowYen, shortfallYen, insuranceBenefitsYen, shortfallOptionsConsidered,
  }
}
