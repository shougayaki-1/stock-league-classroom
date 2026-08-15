import { describe, expect, it } from 'vitest'
import {
  MARKETPLACE_VISIBILITIES,
  isMarketplaceVisibility,
} from './marketplaceVisibility'

describe('isMarketplaceVisibility', () => {
  it('returns true for all marketplace visibility levels', () => {
    expect(MARKETPLACE_VISIBILITIES).toEqual(['COMMUNITY', 'VERIFIED', 'OFFICIAL'])
    expect(isMarketplaceVisibility('COMMUNITY')).toBe(true)
    expect(isMarketplaceVisibility('VERIFIED')).toBe(true)
    expect(isMarketplaceVisibility('OFFICIAL')).toBe(true)
  })

  it('returns false for non-marketplace visibility levels and invalid values', () => {
    expect(isMarketplaceVisibility('PRIVATE')).toBe(false)
    expect(isMarketplaceVisibility('LINK')).toBe(false)
    expect(isMarketplaceVisibility('ORGANIZATION')).toBe(false)
    expect(isMarketplaceVisibility('PUBLIC')).toBe(false)
    expect(isMarketplaceVisibility(undefined)).toBe(false)
    expect(isMarketplaceVisibility(null)).toBe(false)
    expect(isMarketplaceVisibility('')).toBe(false)
    expect(isMarketplaceVisibility(123)).toBe(false)
  })
})
