import { describe, expect, it } from 'vitest'
import { computeAnnualCashFlow } from './annualCashFlow'

describe('computeAnnualCashFlow', () => {
  it('nets income (after tax) against fixed + variable expenses, separately reported (spec §13.7)', () => {
    const result = computeAnnualCashFlow({
      netIncomeYen: 4800000,
      fixedExpensesYen: 2000000,
      variableExpensesYen: 800000,
      inflationPercent: 0,
    })
    expect(result.totalExpensesYen).toBe(2800000)
    expect(result.netCashFlowYen).toBe(2000000)
    expect(result.fixedExpensesYen).toBe(2000000)
    expect(result.variableExpensesYen).toBe(800000)
  })

  it('applies inflation to variable expenses but the caller decides fixed-expense treatment (spec §13.11: 物価は生活費へ反映)', () => {
    const result = computeAnnualCashFlow({
      netIncomeYen: 4800000, fixedExpensesYen: 2000000, variableExpensesYen: 800000, inflationPercent: 10,
    })
    // Inflation compounds onto variable (living) expenses only — fixed
    // costs (e.g. a fixed-rate mortgage payment) are NOT inflation-adjusted
    // here; that distinction is what "固定費と変動費を区別可能" (§13.7) is for.
    expect(result.variableExpensesYen).toBe(880000)
    expect(result.fixedExpensesYen).toBe(2000000)
  })
})
