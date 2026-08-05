import { describe, expect, it } from 'vitest'
import { deriveSeed, fnv1aHash, mulberry32 } from './index'

describe('fnv1aHash', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1aHash('lesson-run-1:0:acme:3')).toBe(fnv1aHash('lesson-run-1:0:acme:3'))
  })

  it('differs for different inputs', () => {
    expect(fnv1aHash('a')).not.toBe(fnv1aHash('b'))
  })

  it('matches a fixed 32-bit FNV-1a vector', () => {
    expect(fnv1aHash('lesson-run-1:0:acme:3')).toBe(506829764)
  })
})

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)

    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces values in [0, 1)', () => {
    const rand = mulberry32(1)
    for (let i = 0; i < 100; i += 1) {
      const value = rand()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('matches a fixed sequence vector', () => {
    const rand = mulberry32(42)
    expect([rand(), rand(), rand()]).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
    ])
  })
})

describe('deriveSeed', () => {
  it('derives the same numeric seed from the same parts, per the D resolution format', () => {
    const first = deriveSeed(['run-abc', 0, 'acme', 3])
    const second = deriveSeed(['run-abc', 0, 'acme', 3])

    expect(first).toBe(second)
  })

  it('derives a different seed when restoreGeneration changes', () => {
    const beforeRestore = deriveSeed(['run-abc', 0, 'acme', 51])
    const afterRestore = deriveSeed(['run-abc', 1, 'acme', 51])

    expect(beforeRestore).not.toBe(afterRestore)
  })

  it('uses the canonical colon-delimited seed format from resolution D', () => {
    const parts = ['run-abc', 0, 'acme', 3] as const
    expect(deriveSeed([...parts])).toBe(fnv1aHash('run-abc:0:acme:3'))
  })

  it('matches the colon-delimited seed derivation fixed vector', () => {
    expect(deriveSeed(['run-abc', 0, 'acme', 3])).toBe(3149992328)
  })
})
