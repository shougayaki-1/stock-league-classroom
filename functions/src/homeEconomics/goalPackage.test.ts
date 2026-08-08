import { describe, expect, it } from 'vitest'
import { resolveVisibleConcepts } from './goalPackage'

describe('resolveVisibleConcepts', () => {
  it('EMERGENCY_FUND focuses on emergency-fund and risk-management concepts (spec §13.16 example)', () => {
    expect(resolveVisibleConcepts('EMERGENCY_FUND')).toEqual(['EMERGENCY_FUND', 'RISK_MANAGEMENT'])
  })

  it('OVERALL_BALANCE hides nothing — every concept category is visible', () => {
    const visible = resolveVisibleConcepts('OVERALL_BALANCE')
    expect(visible).toEqual(expect.arrayContaining(['INSURANCE', 'HOUSING', 'ASSET_DIVERSIFICATION', 'RETIREMENT_PLANNING', 'EMERGENCY_FUND', 'EDUCATION_FUND', 'RISK_MANAGEMENT']))
  })

  it('HOME_PURCHASE surfaces housing and emergency-fund concepts, not retirement planning', () => {
    const visible = resolveVisibleConcepts('HOME_PURCHASE')
    expect(visible).toContain('HOUSING')
    expect(visible).not.toContain('RETIREMENT_PLANNING')
  })
})
