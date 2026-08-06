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
