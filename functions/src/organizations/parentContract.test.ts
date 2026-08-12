import { describe, expect, it } from 'vitest'
import { assertParentContractAllowsSharedQuota, parentContractStateFrom } from './parentContract'

describe('parentContractStateFrom', () => {
  it('treats ENDED as terminal and defaults every other value to ACTIVE', () => {
    expect(parentContractStateFrom({ parentContractState: 'ENDED' })).toBe('ENDED')
    expect(parentContractStateFrom({ parentContractState: 'ACTIVE' })).toBe('ACTIVE')
    expect(parentContractStateFrom(undefined)).toBe('ACTIVE')
    expect(parentContractStateFrom({})).toBe('ACTIVE')
  })
})

describe('assertParentContractAllowsSharedQuota', () => {
  it('allows the default ACTIVE state and rejects ENDED with the exact message', () => {
    expect(() => assertParentContractAllowsSharedQuota('ACTIVE')).not.toThrow()
    expect(() => assertParentContractAllowsSharedQuota('ENDED')).toThrow(
      '親組織の契約が終了しているため共有枠を利用できません',
    )
  })
})
