export interface AnnualMortgagePaymentInput {
  principalYen: number
  annualInterestRatePercent: number
  remainingYears: number
}

/** Spec §13.9: level annual payment, equal-principal-and-interest ("元利均等返済"). */
export const computeAnnualMortgagePayment = (input: AnnualMortgagePaymentInput): number => {
  // Guard against division by zero: a loan with no remaining years is already paid off
  if (input.remainingYears <= 0) return 0

  const r = input.annualInterestRatePercent / 100
  if (r === 0) return Math.round(input.principalYen / input.remainingYears)
  const factor = (1 + r) ** input.remainingYears
  return Math.round((input.principalYen * r * factor) / (factor - 1))
}

export interface MortgageRoundInput {
  remainingPrincipalYen: number
  annualInterestRatePercent: number
  remainingYears: number
  roundYears: number
}
export interface MortgageRoundResult {
  totalPaymentYen: number
  principalPaidYen: number
  interestPaidYen: number
  newRemainingPrincipalYen: number
  newRemainingYears: number
}

/**
 * Advances `roundYears` years of level payments in one call — a round
 * (5 years by default, spec §13.1) covers multiple payment years at once.
 * Stops early (never goes negative) if the loan pays off before
 * `roundYears` elapses.
 */
export const applyMortgageRound = (input: MortgageRoundInput): MortgageRoundResult => {
  let remainingPrincipalYen = input.remainingPrincipalYen
  let remainingYears = input.remainingYears
  let totalPaymentYen = 0
  let interestPaidYen = 0

  const yearsToRun = Math.min(input.roundYears, input.remainingYears)
  for (let year = 0; year < yearsToRun; year += 1) {
    if (remainingPrincipalYen <= 0) break
    const payment = computeAnnualMortgagePayment({
      principalYen: remainingPrincipalYen, annualInterestRatePercent: input.annualInterestRatePercent, remainingYears,
    })
    const interestThisYear = Math.round(remainingPrincipalYen * (input.annualInterestRatePercent / 100))
    const principalThisYear = Math.min(remainingPrincipalYen, payment - interestThisYear)
    remainingPrincipalYen -= principalThisYear
    remainingYears -= 1
    totalPaymentYen += interestThisYear + principalThisYear
    interestPaidYen += interestThisYear
  }

  return {
    totalPaymentYen,
    principalPaidYen: totalPaymentYen - interestPaidYen,
    interestPaidYen,
    newRemainingPrincipalYen: Math.max(0, remainingPrincipalYen),
    newRemainingYears: Math.max(0, remainingYears),
  }
}
