import { describe, expect, it } from 'vitest'
import { officialTemplateSeeds } from './officialSeeds'

describe('official template seeds', () => {
  it('provides three classroom-ready scenarios with tradable companies', () => {
    expect(officialTemplateSeeds).toHaveLength(3)
    for (const seed of officialTemplateSeeds) {
      expect(seed.spec.companies.length).toBeGreaterThanOrEqual(3)
      expect(seed.spec.startingCash).toBeGreaterThan(0)
    }
  })
})
