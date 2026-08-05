import { describe, expect, it } from 'vitest'
import { canonicalJson, idempotencyDocumentId, requestDigest } from './idempotency'

describe('idempotencyDocumentId', () => {
  it('hashes slash-containing and long keys into a 64-character hexadecimal id', () => {
    const id = idempotencyDocumentId('lesson-run', `student/a/${'x'.repeat(2_000)}`)

    expect(id).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses scope as part of the idempotency identity', () => {
    expect(idempotencyDocumentId('join', 'same-key')).not.toBe(
      idempotencyDocumentId('leave', 'same-key'),
    )
  })

  it('does not allow ambiguous scope/key concatenation', () => {
    expect(idempotencyDocumentId('a', 'b:c')).not.toBe(
      idempotencyDocumentId('a:b', 'c'),
    )
  })
})

describe('canonicalJson and requestDigest', () => {
  it('sorts plain-object keys recursively', () => {
    expect(canonicalJson({ b: { z: 1, a: 2 }, a: 3 })).toBe(
      canonicalJson({ a: 3, b: { a: 2, z: 1 } }),
    )
    expect(requestDigest({ a: 1, b: 2 })).toBe(requestDigest({ b: 2, a: 1 }))
  })

  it('uses UTF-16 code-unit ordering rather than locale collation for object keys', () => {
    expect(canonicalJson({ a: 1, Z: 2 })).toBe('{"Z":2,"a":1}')
  })

  it('preserves array order and values in the digest', () => {
    expect(requestDigest([1, 2])).not.toBe(requestDigest([2, 1]))
    expect(requestDigest({ count: 1 })).not.toBe(requestDigest({ count: 2 }))
  })

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    new Date(),
    () => undefined,
    Symbol('value'),
  ])('rejects non-JSON values without silently omitting them: %s', (value) => {
    expect(() => canonicalJson(value)).toThrow()
  })

  it('rejects cycles instead of silently producing a partial representation', () => {
    const value: { self?: unknown } = {}
    value.self = value

    expect(() => canonicalJson(value)).toThrow(/cyclic/i)
  })

  it('rejects sparse arrays and extra array properties instead of colliding with JSON omissions', () => {
    const sparse = [1, , 3]
    const decorated = [1, 2] as number[] & { extra?: number }
    decorated.extra = 3

    expect(() => canonicalJson(sparse)).toThrow()
    expect(() => canonicalJson(decorated)).toThrow()
  })

  it('rejects symbol and non-enumerable properties instead of omitting them', () => {
    const withSymbol = { visible: true }
    Object.defineProperty(withSymbol, Symbol('hidden'), { value: 'x' })
    const withHidden = { visible: true }
    Object.defineProperty(withHidden, 'hidden', { value: 'x' })

    expect(() => canonicalJson(withSymbol)).toThrow()
    expect(() => canonicalJson(withHidden)).toThrow()
  })
})
