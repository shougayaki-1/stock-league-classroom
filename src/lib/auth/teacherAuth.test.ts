import { describe, expect, it } from 'vitest'
import { signInTeacherWithGoogle } from './teacherAuth'

describe('teacher Google sign-in', () => {
  it('exposes the Google popup sign-in boundary', () => {
    expect(signInTeacherWithGoogle).toBeTypeOf('function')
  })
})
