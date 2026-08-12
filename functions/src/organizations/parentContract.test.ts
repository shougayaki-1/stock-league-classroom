import { describe, expect, it } from 'vitest'
import { parentContractStateFrom } from './parentContract'

describe('parentContractStateFrom', () => {
  it('treats ENDED as terminal and defaults every other value to ACTIVE', () => {
    expect(parentContractStateFrom({ parentContractState: 'ENDED' })).toBe('ENDED')
    expect(parentContractStateFrom({ parentContractState: 'ACTIVE' })).toBe('ACTIVE')
    expect(parentContractStateFrom(undefined)).toBe('ACTIVE')
    expect(parentContractStateFrom({})).toBe('ACTIVE')
  })
})
