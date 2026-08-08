import type { LessonRunRole } from '@stock-league/lesson-runtime-types'

/**
 * §6.5 の授業中操作を漏れなく列挙したもの。3グループに分かれる:
 *
 * - 主担当専属: 開始、終了、市場停止、設定変更、主担当移譲
 * - 主担当・補助担当ともに可: ニュース公開、時間延長、生徒支援、接続対応
 * - 全ロール可: 進行状況と結果の閲覧
 *
 * TRANSITION_PHASE（フェーズ遷移）は §6.5 の本文に明記されていない独自区分。
 * 開始・終了・市場停止と同じく「授業全体の進行を単一の意思決定点に保つ」操作
 * であり、複数教師が同時に遷移を発行すると進行状態が競合しうるため、主担当
 * 専属（PRIMARY のみ）として扱う。これは統合仕様書に明記のない独自判断。
 */
export type LessonControlAction =
  | 'START_LESSON'
  | 'END_LESSON'
  | 'STOP_MARKET'
  | 'CHANGE_SETTINGS'
  | 'TRANSFER_PRIMARY'
  | 'TRANSITION_PHASE'
  | 'PUBLISH_NOTICE'
  | 'EXTEND_TIME'
  | 'SUPPORT_STUDENT'
  | 'HANDLE_CONNECTION'
  | 'VIEW_PROGRESS'
  | 'VIEW_RESULTS'

export const lessonControlActions: LessonControlAction[] = [
  'START_LESSON',
  'END_LESSON',
  'STOP_MARKET',
  'CHANGE_SETTINGS',
  'TRANSFER_PRIMARY',
  'TRANSITION_PHASE',
  'PUBLISH_NOTICE',
  'EXTEND_TIME',
  'SUPPORT_STUDENT',
  'HANDLE_CONNECTION',
  'VIEW_PROGRESS',
  'VIEW_RESULTS',
]

export const lessonControlPermissions: Record<LessonControlAction, LessonRunRole[]> = {
  // 主担当専属
  START_LESSON: ['PRIMARY'],
  END_LESSON: ['PRIMARY'],
  STOP_MARKET: ['PRIMARY'],
  CHANGE_SETTINGS: ['PRIMARY'],
  TRANSFER_PRIMARY: ['PRIMARY'],
  // 独自判断（コメント参照）: 主担当専属として扱う
  TRANSITION_PHASE: ['PRIMARY'],
  // 主担当・補助担当ともに可
  PUBLISH_NOTICE: ['PRIMARY', 'ASSISTANT'],
  EXTEND_TIME: ['PRIMARY', 'ASSISTANT'],
  SUPPORT_STUDENT: ['PRIMARY', 'ASSISTANT'],
  HANDLE_CONNECTION: ['PRIMARY', 'ASSISTANT'],
  // 全ロール可
  VIEW_PROGRESS: ['PRIMARY', 'ASSISTANT', 'VIEWER'],
  VIEW_RESULTS: ['PRIMARY', 'ASSISTANT', 'VIEWER'],
}

/**
 * 授業のホストは端末に固定しない（§6.5）。主担当が落ちても TRANSFER_PRIMARY
 * で別教師へ引き継げるため、ロールの判定はこの表に対する単純な参照のみで
 * 完結し、端末やセッションの状態を一切見ない。
 */
export const canControlLesson = (role: LessonRunRole, action: LessonControlAction): boolean =>
  lessonControlPermissions[action].includes(role)
