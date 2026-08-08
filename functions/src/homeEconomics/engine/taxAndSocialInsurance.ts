/**
 * PROVISIONAL — spec §13.8 requires an educational simplified formula
 * "実際の税率へ依存し過ぎない", not real tax law, and requires the exact
 * rate to be pinned per template version rather than recomputed live.
 * This flat 20% combined rate for model version 1 is a starting value to
 * be adjusted during pilot runs — see Task 17's PROVISIONAL constants
 * roundup.
 */
export const TAX_MODEL_V1_RATE_PERCENT = 20

export interface TaxAndSocialInsuranceInput {
  grossIncomeYen: number
}
export interface TaxResult {
  netIncomeYen: number
  taxAndInsuranceYen: number
}

/**
 * Spec §13.8: "数値・式の版を教材版へ固定する" — the model version comes
 * from `HomeEconomicsContent.taxAndSocialInsuranceModelVersion` (Task 2),
 * captured in the LessonRun's immutable `templateSnapshot` at creation
 * time (Phase A's template/version pattern). A lesson already running
 * must never have its tax formula change underneath it because a teacher
 * edited the draft — callers always pass the SNAPSHOT's model version,
 * never a live lookup.
 */
export const computeTaxAndSocialInsurance = (input: TaxAndSocialInsuranceInput, modelVersion: number): TaxResult => {
  if (modelVersion !== 1) throw new Error(`Unknown tax and social insurance model version: ${modelVersion}`)
  const taxAndInsuranceYen = Math.round(input.grossIncomeYen * (TAX_MODEL_V1_RATE_PERCENT / 100))
  return { netIncomeYen: input.grossIncomeYen - taxAndInsuranceYen, taxAndInsuranceYen }
}
