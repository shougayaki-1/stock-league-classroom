import type { Timestamp } from 'firebase/firestore'
import type { LessonContent } from '../lessonTemplates/types'

export type LessonRunStatus =
  | 'DRAFT' | 'READY' | 'WAITING' | 'RUNNING' | 'PAUSED'
  | 'INTERRUPTED' | 'REFLECTION' | 'COMPLETED' | 'ABORTED' | 'ARCHIVED'

export interface LessonRun {
  id: string
  orgId: string
  templateId: string
  templateVersionId: string
  templateSnapshot: LessonContent
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  status: LessonRunStatus
  primaryTeacherUid: string
  teacherRoles: Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'>
  currentPhaseId: string | null
  randomSeed: string
  restoreGeneration: number
  startedAt: Timestamp | null
  endedAt: Timestamp | null
  createdAt: Timestamp
}
