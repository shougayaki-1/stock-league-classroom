import { describe, expect, it } from 'vitest'
import { companyFields, createEmptyCompany } from './socialStudies/fieldConfigs'
import { createEmptyHouseholdProfile, createEmptyInsuranceProduct, createEmptyLifeEvent, householdProfileFields, insuranceProductFields, lifeEventFields } from './homeEconomics/fieldConfigs'

describe('authoring field configurations', () => {
  it('excludes every internal coefficient and seeds safe defaults', () => {
    expect(companyFields.map((field) => field.key)).not.toContain('impactSensitivities')
    expect(householdProfileFields.map((field) => field.key)).not.toContain('internalRiskFactors')
    expect(insuranceProductFields.map((field) => field.key)).not.toContain('internalClaimProbability')
    expect(lifeEventFields.map((field) => field.key)).not.toContain('triggerProbability')
    expect(createEmptyCompany().impactSensitivities).toEqual({})
    expect(createEmptyHouseholdProfile().internalRiskFactors).toEqual({})
    expect(createEmptyInsuranceProduct().internalClaimProbability).toBe(0)
    expect(createEmptyLifeEvent().triggerProbability).toBe(0)
  })
})
