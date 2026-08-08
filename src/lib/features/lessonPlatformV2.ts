/**
 * Feature flag for the Phase B lesson platform routes (Task 17). Nothing
 * else in this repo currently has a Feature Flag mechanism (verified via
 * `grep -rn "featureFlag\|FEATURE_FLAG" src/`), so this is deliberately a
 * single-purpose boolean read off an env var rather than a general Flag
 * management system — YAGNI until a second flag is actually needed.
 *
 * Kept off by default: only the literal string `'true'` enables it, so an
 * unset/misconfigured/typo'd env value never accidentally exposes the
 * still-internal-test-only teacher/student/display routes to real users.
 */
export const isLessonPlatformV2Enabled = (env: Record<string, string | boolean | undefined> = import.meta.env): boolean =>
  env.VITE_FEATURE_LESSON_PLATFORM_V2 === 'true'
