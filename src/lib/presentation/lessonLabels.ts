import type { LessonRunRole } from '../lessonRuns/authorization'
import type { LessonRunDisplayMode } from '../lessonRuns/liveTypes'
import type { LessonParticipantView } from '../lessonRuns/participants'
import type { LessonRunStatus } from '../lessonRuns/types'
import { safeLabel } from './safeLabel'

export const LESSON_RUN_STATUS_LABELS = {
  DRAFT: '下書き',
  READY: '開始準備完了',
  WAITING: '参加待ち',
  RUNNING: '授業中',
  PAUSED: '一時停止',
  INTERRUPTED: '中断中',
  REFLECTION: '振り返り',
  COMPLETED: '終了',
  ABORTED: '中止',
  ARCHIVED: 'アーカイブ済み',
} satisfies Record<LessonRunStatus, string>

export const LESSON_DISPLAY_MODE_LABELS = {
  START: '開始待機の画面',
  LIVE: '授業中の画面',
  END: '終了の画面',
  EXPLANATION: '解説の画面',
  HOUSEHOLD_COMPARISON: 'クラス比較の画面',
} satisfies Record<LessonRunDisplayMode, string>

export const LESSON_RUN_ROLE_LABELS = {
  PRIMARY: '主担当',
  ASSISTANT: '補助担当',
  VIEWER: '閲覧担当',
} satisfies Record<LessonRunRole, string>

export const PARTICIPANT_STATUS_LABELS = {
  ACTIVE: '参加中',
  TEMPORARILY_DISCONNECTED: '一時切断',
  ABSENT: '欠席',
  OBSERVER: '見学',
  LATE_JOIN: '途中参加',
  MIGRATING_DEVICE: '端末移行中',
  SUSPENDED: '参加停止',
} satisfies Record<LessonParticipantView['status'], string>

export const formatLessonRunStatus = (value: string | null | undefined): string =>
  safeLabel(value, LESSON_RUN_STATUS_LABELS, '授業状態を確認できません')

export const formatLessonDisplayMode = (value: string | null | undefined): string =>
  safeLabel(value, LESSON_DISPLAY_MODE_LABELS, '教室表示の状態を確認できません')

export const formatLessonRunRole = (value: string | null | undefined): string =>
  safeLabel(value, LESSON_RUN_ROLE_LABELS, '担当権限を確認できません')

export const formatParticipantStatus = (value: string | null | undefined): string =>
  safeLabel(value, PARTICIPANT_STATUS_LABELS, '参加状態を確認できません')

const PRE_START_STATUSES = new Set<LessonRunStatus>(['DRAFT', 'READY', 'WAITING'])

export const formatCurrentPhaseLabel = (
  currentPhaseLabel: string | null | undefined,
  status: string | null | undefined,
): string => {
  const label = currentPhaseLabel?.trim()
  if (label) return label
  if (status && PRE_START_STATUSES.has(status as LessonRunStatus)) return '未開始'
  return 'フェーズ名を確認できません'
}
