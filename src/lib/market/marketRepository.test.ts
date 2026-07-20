import { describe, expect, it } from 'vitest'
import { participantId } from './liveMarketTypes'

describe('market identity', () => {
  it('keeps each device session distinct for a student', () => {
    expect(participantId('student', 'a')).toBe('student_a')
    expect(participantId('student', 'b')).not.toBe(participantId('student', 'a'))
  })
})
