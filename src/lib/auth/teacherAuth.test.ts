import { describe, expect, it } from 'vitest'
import { getTeacherGoogleRedirectResult, signInTeacherWithGoogle } from './teacherAuth'

describe('teacher Google sign-in', () => {
  it('exposes the Google redirect sign-in boundary', () => {
    expect(signInTeacherWithGoogle).toBeTypeOf('function')
  })

  it('exposes the redirect result reader', () => {
    expect(getTeacherGoogleRedirectResult).toBeTypeOf('function')
  })
})
