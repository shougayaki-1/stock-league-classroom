import { describe, expect, it } from 'vitest'
import type { LessonRunPrivateState, LessonRunPublicState } from './liveTypes'

describe('LessonRunPublicState / LessonRunPrivateState field separation', () => {
  it('LessonRunPublicState has no field named randomSeed or containing "seed"', () => {
    const publicKeys: (keyof LessonRunPublicState)[] = ['status', 'currentPhaseId', 'updatedAtMillis']
    expect(publicKeys.some((key) => key.toLowerCase().includes('seed'))).toBe(false)
  })
  it('LessonRunPrivateState carries randomSeed', () => {
    const privateKeys: (keyof LessonRunPrivateState)[] = ['randomSeed', 'restoreGeneration', 'updatedAtMillis']
    expect(privateKeys).toContain('randomSeed')
  })
})
