import { describe, expect, it } from 'vitest'
import { normalizeSignageData } from './signageData'

describe('normalizeSignageData', () => {
  it('fills missing projection collections without throwing', () => {
    expect(normalizeSignageData({ joinCode: 'ABC123', phase: 'PAUSED' })).toEqual({
      joinCode: 'ABC123', prices: [], publicNews: [], leaderboard: [], phase: 'PAUSED',
    })
  })

  it('rejects an unusable projection', () => {
    expect(normalizeSignageData({ joinCode: 'ABC123' })).toBeUndefined()
  })
})
