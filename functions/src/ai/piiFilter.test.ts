import { describe, expect, it } from 'vitest'
import { assertNoForbiddenFields } from './piiFilter'
describe('assertNoForbiddenFields', () => {
  it('allows teacher-authored input and rejects forbidden keys at every depth', () => {
    expect(() => assertNoForbiddenFields({ theme: '企業', nested: { objective: '需給' } })).not.toThrow()
    expect(() => assertNoForbiddenFields({ profile: { studentName: '山田' } })).toThrow('studentName')
    expect(() => assertNoForbiddenFields({ email: 'student@example.com' })).toThrow('email')
  })
})
