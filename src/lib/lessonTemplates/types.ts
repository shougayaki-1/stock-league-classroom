import type { Timestamp } from 'firebase/firestore'

/**
 * Minimum content envelope for Phase A. The full authoring content (rounds, market
 * config, assessment rubric, etc. — spec §12/§13) is Phase C/D's concern.
 * Phase A only needs a content envelope stable enough to version.
 */
export interface LessonContent {
  schemaVersion: 1
  title: string
  description: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
}

export interface LessonTemplate {
  id: string
  orgId: string
  createdByUid: string
  draft: LessonContent
  currentPublishedVersionId: string | null
  status: 'DRAFT' | 'READY' | 'ARCHIVED'
  visibility: 'PRIVATE' | 'LINK' | 'ORGANIZATION' | 'PUBLIC'
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * Schedule-sensitive settings that must be reset (not silently carried over)
 * when duplicating a lesson template — dates, publish times, time limits,
 * class assignment, absence handling, notifications — per the duplication
 * design. As of Phase A/B, `LessonContent` above carries none of these
 * fields yet; they belong to Phase C/D's authoring content (rounds, market
 * config, assessment rubric, etc.). This type is therefore an intentionally
 * empty placeholder, mirroring the same "minimal now, extend later" pattern
 * `LessonContent.schemaVersion` already establishes. When Phase C/D adds
 * such fields to `LessonContent`, add the matching fields here too, and
 * extend `duplicateLessonTemplate`'s (functions/src/lessonTemplates)
 * carry-over/reset/confirmedOverrides classification to match — do not
 * invent fields ahead of that work.
 */
export type ScheduleSensitiveSettings = Record<string, never>

export interface LessonVersion {
  id: string
  templateId: string
  orgId: string
  schemaVersion: number
  content: LessonContent
  createdByUid: string
  createdAt: Timestamp
  changeSummary?: string
  parentVersionId?: string
  immutable: true
}
