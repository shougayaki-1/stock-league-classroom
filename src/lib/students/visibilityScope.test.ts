import { describe, it, expect } from 'vitest'
import { canViewOtherPortfolio, canViewLeaderboardOnly } from './visibilityScope'

describe('canViewOtherPortfolio', () => {
  it('private では自分/自チーム以外は見えない', () => {
    expect(canViewOtherPortfolio('private', false)).toBe(false)
    expect(canViewOtherPortfolio('private', true)).toBe(true)
  })
  it('ranking_only では他人のポートフォリオ詳細は見えない', () => {
    expect(canViewOtherPortfolio('ranking_only', false)).toBe(false)
  })
  it('public では誰でも見える', () => {
    expect(canViewOtherPortfolio('public', false)).toBe(true)
  })
})

describe('canViewLeaderboardOnly', () => {
  it('ranking_only の場合に true を返す', () => {
    expect(canViewLeaderboardOnly('ranking_only')).toBe(true)
  })
  it('private と public の場合は false を返す', () => {
    expect(canViewLeaderboardOnly('private')).toBe(false)
    expect(canViewLeaderboardOnly('public')).toBe(false)
  })
})
