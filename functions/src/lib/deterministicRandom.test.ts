import { describe, expect, it } from 'vitest'
import { deriveSeed, fnv1aHash, mulberry32 } from './deterministicRandom'

describe('deterministicRandom package consumption', () => {
  it('loads the built CommonJS package from the Functions dependency', () => {
    expect(fnv1aHash('a')).toBe(3826002220)
    expect(deriveSeed(['run-abc', 0, 'acme', 3])).toBe(997618770)

    const random = mulberry32(42)
    expect([random(), random(), random()]).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
    ])
  })
})
