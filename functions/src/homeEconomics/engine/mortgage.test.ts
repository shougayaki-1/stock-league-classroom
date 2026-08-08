import { describe, expect, it } from 'vitest'
import { applyMortgageRound, computeAnnualMortgagePayment } from './mortgage'

describe('computeAnnualMortgagePayment', () => {
  it('computes the level annual payment for an equal-principal-and-interest mortgage (spec §13.9)', () => {
    // 30,000,000円、年利2%、返済期間20年 — 教育用の簡略年次複利モデル。
    // r=0.02, n=20 の資本回収係数(A/P)はおよそ0.0612なので、支払額は
    // 30,000,000 * 0.0612 ≒ 1,836,000円前後になるはず——手計算での複利誤差を
    // 考慮し、厳密な一致ではなく妥当な範囲で検証する。総返済額(20年分)が
    // 元本を上回る(利息が発生している)ことも合わせて確認する。
    const payment = computeAnnualMortgagePayment({ principalYen: 30000000, annualInterestRatePercent: 2, remainingYears: 20 })
    expect(payment).toBeGreaterThan(1800000)
    expect(payment).toBeLessThan(1900000)
    expect(payment * 20).toBeGreaterThan(30000000)
  })

  it('a zero-interest loan divides principal evenly across the remaining years', () => {
    const payment = computeAnnualMortgagePayment({ principalYen: 20000000, annualInterestRatePercent: 0, remainingYears: 20 })
    expect(payment).toBe(1000000)
  })
})

describe('applyMortgageRound', () => {
  it('advances 5 years of level payments, splitting each year\'s payment into principal/interest, and reduces remainingYears', () => {
    const result = applyMortgageRound({
      remainingPrincipalYen: 30000000, annualInterestRatePercent: 2, remainingYears: 20, roundYears: 5,
    })
    expect(result.newRemainingYears).toBe(15)
    expect(result.newRemainingPrincipalYen).toBeLessThan(30000000)
    expect(result.totalPaymentYen).toBeGreaterThan(1800000 * 5)
    expect(result.totalPaymentYen).toBeLessThan(1900000 * 5)
    expect(result.principalPaidYen + result.interestPaidYen).toBeCloseTo(result.totalPaymentYen, 0)
  })

  it('pays off the loan early and stops — a round longer than the remaining term never goes negative', () => {
    const result = applyMortgageRound({
      remainingPrincipalYen: 1000000, annualInterestRatePercent: 2, remainingYears: 2, roundYears: 5,
    })
    expect(result.newRemainingYears).toBe(0)
    expect(result.newRemainingPrincipalYen).toBe(0)
  })
})
