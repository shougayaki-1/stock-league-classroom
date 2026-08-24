import { describe, expect, it } from 'vitest'
import { safeLabel } from './safeLabel'

const LABELS = {
  ACTIVE: '有効',
  DISABLED: '無効',
} satisfies Record<'ACTIVE' | 'DISABLED', string>

describe('safeLabel', () => {
  it('returns the mapped presentation value for a known token', () => {
    expect(safeLabel('ACTIVE', LABELS, '状態を確認できません')).toBe('有効')
  })

  it('does not echo an unknown internal token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const result = safeLabel(raw, LABELS, '状態を確認できません')

    expect(result).toBe('状態を確認できません')
    expect(result).not.toContain(raw)
  })

  it.each([undefined, null, ''])('uses the fallback for missing value %s', (value) => {
    expect(safeLabel(value, LABELS, '状態を確認できません')).toBe('状態を確認できません')
  })
})
