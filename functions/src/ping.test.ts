import { describe, expect, it } from 'vitest'
import { pingPayload } from './ping'

describe('pingPayload', () => {
  it('returns a fixed ok payload', () => {
    expect(pingPayload()).toEqual({ ok: true })
  })
})
