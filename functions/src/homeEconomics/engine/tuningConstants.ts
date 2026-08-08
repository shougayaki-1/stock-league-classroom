/**
 * PROVISIONAL tuning constants — single-source index (Task 17, Phase D
 * completion condition 4).
 *
 * Every value re-exported here is a placeholder chosen during Phase D
 * implementation because the integrated spec (統合仕様書) leaves no fixed
 * numeric default for it — each site is individually documented as
 * PROVISIONAL at its point of definition. This file does not redefine any
 * of them; it only re-exports the existing single-source constants (same
 * discipline as `functions/src/market/engine/tuningConstants.ts`, Phase C
 * Task 19's precedent for this exact file) so a playtesting/teacher-facing
 * tuning pass has one place to look before touching any of them.
 *
 * Do NOT hardcode a second copy of these values anywhere else in the
 * codebase — always import from the original module (or from here).
 *
 * | Constant | Defined in | Meaning |
 * | --- | --- | --- |
 * | `TAX_MODEL_V1_RATE_PERCENT` | engine/taxAndSocialInsurance.ts | Flat combined tax + social-insurance rate applied to gross income under tax model version 1 (spec §13.8 requires a pinned, simplified formula without specifying the rate). |
 * | `EMERGENCY_FUND_TARGET_MONTHS` | evaluation.ts | Months of living expenses in cash used as the 100-point target for the emergency-fund-adequacy evaluation criterion (spec §13.17 requires the criterion without specifying the threshold). |
 * | `PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT` | engine/retirement.ts | Default pension income-replacement rate for `computeSimplifiedPensionBenefit` (spec §13.14 requires only "年金等の簡略給付" without a specified rate). **Known gap, not just an unset default**: unlike the two constants above, this one is not consumed anywhere in production round settlement — `computeSimplifiedPensionBenefit`/`computeVoluntaryAssetDrawdown` (both `engine/retirement.ts`) are pure functions exercised only by their own test file; `settleRound.ts` never calls either. `HomeEconomicsContent` also has no field carrying a teacher-authored replacement rate. This constant gives a single documented starting value for whenever that wiring is added, rather than a value invented ad hoc at the call site; it does not by itself mean pension income is applied during a lesson today. See task-17-report.md for the full investigation. |
 */

export { TAX_MODEL_V1_RATE_PERCENT } from './taxAndSocialInsurance'
export { EMERGENCY_FUND_TARGET_MONTHS } from '../evaluation'
export { PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT } from './retirement'
