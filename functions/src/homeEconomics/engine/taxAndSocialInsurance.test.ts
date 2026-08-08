import { describe, expect, it } from 'vitest'
import { computeTaxAndSocialInsurance } from './taxAndSocialInsurance'

describe('computeTaxAndSocialInsurance', () => {
  it('applies model version 1\'s simplified flat-rate formula (spec §13.8 — pinned to template version, not live tax law)', () => {
    const result = computeTaxAndSocialInsurance({ grossIncomeYen: 6000000 }, 1)
    // Model v1: 20% combined tax+social-insurance rate — PROVISIONAL, see
    // TAX_MODEL_V1_RATE_PERCENT below. Exact value is not from live tax law.
    expect(result.netIncomeYen).toBe(4800000)
    expect(result.taxAndInsuranceYen).toBe(1200000)
  })

  it('throws for an unknown model version rather than silently falling back (spec §13.8: pinned, never live-recomputed)', () => {
    expect(() => computeTaxAndSocialInsurance({ grossIncomeYen: 6000000 }, 99)).toThrow('Unknown tax and social insurance model version: 99')
  })
})
