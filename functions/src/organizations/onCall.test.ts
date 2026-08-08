import { describe, expect, it } from 'vitest'
import { isCallerTeacher } from './onCall'

describe('isCallerTeacher', () => {
  it('accepts a verified google.com sign-in', () => {
    expect(isCallerTeacher({ email_verified: true, firebase: { sign_in_provider: 'google.com' } })).toBe(true)
  })
  it('rejects anonymous sign-in', () => {
    expect(isCallerTeacher({ firebase: { sign_in_provider: 'anonymous' } })).toBe(false)
  })
  it('rejects an unverified email', () => {
    expect(isCallerTeacher({ email_verified: false, firebase: { sign_in_provider: 'google.com' } })).toBe(false)
  })
})
