import { describe, expect, it } from 'vitest'
import type { PublicSupportProgram } from '@stock-league/household-authoring-content'
import { computePublicSupportAvailableYen, determineEligiblePrograms } from './publicSupport'

const childcareSupport: PublicSupportProgram = {
  id: 'childcare', label: '子育て支援金', conditionDescription: '世帯収入が500万円未満',
  maxHouseholdIncomeYen: 5000000, applicationMode: 'AUTOMATIC', benefitAmountYen: 200000,
}
const emergencyGrant: PublicSupportProgram = {
  id: 'emergency', label: '緊急給付金', conditionDescription: '所得制限なし',
  maxHouseholdIncomeYen: null, applicationMode: 'APPLICATION_REQUIRED', benefitAmountYen: 100000,
}

describe('determineEligiblePrograms', () => {
  it('includes a program only when household income is under its threshold', () => {
    expect(determineEligiblePrograms([childcareSupport], 4000000)).toEqual([childcareSupport])
    expect(determineEligiblePrograms([childcareSupport], 6000000)).toEqual([])
  })

  it('a null maxHouseholdIncomeYen means no income restriction — always eligible on that axis', () => {
    expect(determineEligiblePrograms([emergencyGrant], 100000000)).toEqual([emergencyGrant])
  })
})

describe('computePublicSupportAvailableYen', () => {
  it('sums AUTOMATIC eligible programs without needing to be in appliedProgramIds', () => {
    expect(computePublicSupportAvailableYen([childcareSupport], [])).toBe(200000)
  })

  it('APPLICATION_REQUIRED programs only count when their id is in appliedProgramIds (spec §13.10: 申請選択)', () => {
    expect(computePublicSupportAvailableYen([emergencyGrant], [])).toBe(0)
    expect(computePublicSupportAvailableYen([emergencyGrant], ['emergency'])).toBe(100000)
  })

  it('combines both modes correctly', () => {
    expect(computePublicSupportAvailableYen([childcareSupport, emergencyGrant], ['emergency'])).toBe(300000)
  })
})
