import type { Timestamp } from 'firebase/firestore'
import type { SocialStudiesMarketContent } from '@stock-league/market-authoring-content'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'

export type {
  EconomicIndicatorAuthoring,
  InformationItem,
  PredictionEvaluationTarget,
  SimulatedCompany,
  SocialStudiesEvaluationWeights,
  SocialStudiesMarketContent,
} from '@stock-league/market-authoring-content'

export type { HomeEconomicsContent } from '@stock-league/household-authoring-content'

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
  /**
   * 中核フェーズ（社会科は取引、家庭科は意思決定）に充てる分数。
   * `buildDefaultPhases` がこの値を中核フェーズの `durationSeconds` にする。
   *
   * 任意フィールドである。この値が導入される前に作られた教材は持たず、その
   * 場合は従来どおり全フェーズが制限時間なしで動く。既存ドキュメントの読み
   * 取りが壊れる変更ではないため `schemaVersion` は上げない。
   */
  coreActivityMinutes?: number
  /** Only present when subject === 'SOCIAL_STUDIES'. Optional so existing
   * HOME_ECONOMICS drafts and Phase A's minimal placeholder keep compiling. */
  socialStudiesMarket?: SocialStudiesMarketContent
  /** Only present when subject === 'HOME_ECONOMICS'. Optional so existing SOCIAL_STUDIES drafts keep compiling. */
  homeEconomics?: HomeEconomicsContent
}

export type LessonTemplateVisibility =
  | 'PRIVATE'
  | 'LINK'
  | 'ORGANIZATION'
  | 'COMMUNITY'
  | 'VERIFIED'
  | 'OFFICIAL'

export interface LessonTemplate {
  id: string
  orgId: string
  createdByUid: string
  draft: LessonContent
  currentPublishedVersionId: string | null
  status: 'DRAFT' | 'READY' | 'ARCHIVED'
  visibility: LessonTemplateVisibility
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'
  moveOperationId?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  sourceTemplateId?: string
  sourceTemplateTitle?: string
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
