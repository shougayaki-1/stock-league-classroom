import { describe, expect, it } from 'vitest'
import { activeParticipantStatuses, canParticipantOperate } from './index'

describe('participant access', () => {
  it('allows active and late participants but denies suspended participants', () => {
    expect(activeParticipantStatuses).toContain('ACTIVE')
    expect(canParticipantOperate('LATE_JOIN')).toBe(true)
    expect(canParticipantOperate('OBSERVER')).toBe(false)
    expect(canParticipantOperate('SUSPENDED')).toBe(false)
  })
})
