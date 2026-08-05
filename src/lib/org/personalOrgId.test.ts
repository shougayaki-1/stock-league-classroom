import { describe, expect, it } from 'vitest'
import { personalOrgId } from './personalOrgId'

describe('personalOrgId', () => {
  it('prefixes the uid with personal_', () => {
    expect(personalOrgId('abc123')).toBe('personal_abc123')
  })
})
