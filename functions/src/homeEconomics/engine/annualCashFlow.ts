export interface AnnualCashFlowInput {
  netIncomeYen: number
  fixedExpensesYen: number
  variableExpensesYen: number
  /** Spec §13.11: applied to variable (living-cost) expenses only. */
  inflationPercent: number
}
export interface AnnualCashFlowResult {
  fixedExpensesYen: number
  variableExpensesYen: number
  totalExpensesYen: number
  netCashFlowYen: number
}

export const computeAnnualCashFlow = (input: AnnualCashFlowInput): AnnualCashFlowResult => {
  const variableExpensesYen = Math.round(input.variableExpensesYen * (1 + input.inflationPercent / 100))
  const totalExpensesYen = input.fixedExpensesYen + variableExpensesYen
  return {
    fixedExpensesYen: input.fixedExpensesYen,
    variableExpensesYen,
    totalExpensesYen,
    netCashFlowYen: input.netIncomeYen - totalExpensesYen,
  }
}
