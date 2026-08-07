import { describe, expect, it } from 'vitest'
import { isLessonPlatformV2Enabled } from './lessonPlatformV2'

describe('isLessonPlatformV2Enabled', () => {
  it('is disabled when the env var is unset', () => {
    expect(isLessonPlatformV2Enabled({})).toBe(false)
  })

  it('is disabled when the env var is any value other than the string "true"', () => {
    expect(isLessonPlatformV2Enabled({ VITE_FEATURE_LESSON_PLATFORM_V2: 'false' })).toBe(false)
    expect(isLessonPlatformV2Enabled({ VITE_FEATURE_LESSON_PLATFORM_V2: '1' })).toBe(false)
    expect(isLessonPlatformV2Enabled({ VITE_FEATURE_LESSON_PLATFORM_V2: 'TRUE' })).toBe(false)
  })

  it('is enabled only when the env var is exactly the string "true"', () => {
    expect(isLessonPlatformV2Enabled({ VITE_FEATURE_LESSON_PLATFORM_V2: 'true' })).toBe(true)
  })

  it('defaults to reading import.meta.env when no env is supplied', () => {
    expect(isLessonPlatformV2Enabled()).toBe(false)
  })
})
