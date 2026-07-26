import { describe, expect, it } from 'vitest'
import { isTeacherIdentity } from './roles'
const googleUser = { uid: 'teacher', email: 'teacher@example.com', isAnonymous: false, emailVerified: true, providerData: [{ providerId: 'google.com' }] }
describe('teacher identity boundary', () => {
  it('accepts only a verified Google identity', () => expect(isTeacherIdentity(googleUser)).toBe(true))
  it('rejects other providers, unverified, and anonymous identities', () => { expect(isTeacherIdentity({ ...googleUser, providerData: [{ providerId: 'password' }] })).toBe(false); expect(isTeacherIdentity({ ...googleUser, emailVerified: false })).toBe(false); expect(isTeacherIdentity({ ...googleUser, isAnonymous: true })).toBe(false) })
})
