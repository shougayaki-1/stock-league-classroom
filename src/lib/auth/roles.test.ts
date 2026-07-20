import { describe, expect, it } from 'vitest'
import { isTeacherIdentity } from './roles'
const emailLinkUser = { uid: 'teacher', email: 'teacher@example.com', isAnonymous: false, emailVerified: true, providerData: [{ providerId: 'password' }] }
describe('teacher identity boundary', () => {
  it('accepts only a verified controlled email-link provider identity', () => expect(isTeacherIdentity(emailLinkUser)).toBe(true))
  it('rejects arbitrary federated or unverified email identities', () => { expect(isTeacherIdentity({ ...emailLinkUser, providerData: [{ providerId: 'google.com' }] })).toBe(false); expect(isTeacherIdentity({ ...emailLinkUser, emailVerified: false })).toBe(false); expect(isTeacherIdentity({ ...emailLinkUser, isAnonymous: true })).toBe(false) })
})
