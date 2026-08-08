import type { LessonInputConfig } from '@stock-league/lesson-inputs'

/**
 * §振り返り方式(Task14ブリーフStep4)。`LessonPhase`(functions/src/
 * lessonRuns/phases/validation.ts)にはまだこの軸を持つフィールドが無いため
 * (§7.5相当の振り返り設定は将来タスクの担当)、`LessonReflectionPage`は
 * 方式を直接propsとして受け取る設計にしている。
 */
export type LessonReflectionMethod =
  | 'CHOICE_ONLY'
  | 'SHORT_TEXT'
  | 'TEAM_DISCUSSION'
  | 'INDIVIDUAL_THEN_TEAM'
  | 'POST_LESSON_SURVEY'

/**
 * 振り返り方式 -> `LessonInputRenderer`(Task6, 9種類のwidget)への
 * マッピング。CHOICE_ONLYは単一選択、SHORT_TEXT/TEAM_DISCUSSIONは短文
 * 自由記述、INDIVIDUAL_THEN_TEAMは個人回答フェーズと同じ短文自由記述
 * widgetを個人->チームの順で2回描画する(呼び出し側が個人用/チーム用の
 * それぞれのconfigを渡す)。POST_LESSON_SURVEYはRendererを使わず、
 * 専用のアンケートUIを描画する('SURVEY'を返す)。
 */
export const mapReflectionMethodToInputType = (method: LessonReflectionMethod): LessonInputConfig['type'] | 'SURVEY' => {
  switch (method) {
    case 'CHOICE_ONLY': return 'SINGLE_CHOICE'
    case 'SHORT_TEXT': return 'SHORT_TEXT'
    case 'TEAM_DISCUSSION': return 'SHORT_TEXT'
    case 'INDIVIDUAL_THEN_TEAM': return 'SHORT_TEXT'
    case 'POST_LESSON_SURVEY': return 'SURVEY'
  }
}

/**
 * §Task14 surveys/schema.ts の`LessonSurveyQuestionType`のクライアント側
 * 複製。`functions/src`とはrootDirが分離されており、直接importできない
 * (`functions/src/lessonRuns/projections/source.ts`のJSDocが説明する既存
 * の設計制約と同じ理由)。値のリストは手で同期を保つ。
 */
export type LessonSurveyQuestionType =
  | 'COMPREHENSION' | 'IMPORTANT_INFO' | 'JUDGMENT_CHANGED' | 'RESULT_GAP' | 'IMPROVEMENT' | 'CLARITY' | 'FREE_TEXT'

export interface LessonSurveyQuestion {
  type: LessonSurveyQuestionType
  required: boolean
  /** 選択式の場合の選択肢。省略時は自由記述(ShortText)として描画する。 */
  options?: string[]
}

export const SURVEY_QUESTION_LABELS: Record<LessonSurveyQuestionType, string> = {
  COMPREHENSION: '授業の内容をどれくらい理解できましたか',
  IMPORTANT_INFO: '判断する際、どの情報を重視しましたか',
  JUDGMENT_CHANGED: '途中で判断は変わりましたか',
  RESULT_GAP: '自分の予想と実際の結果にどれくらい差がありましたか',
  IMPROVEMENT: '次に活かせる改善点は何ですか',
  CLARITY: '授業の説明はわかりやすかったですか',
  FREE_TEXT: 'その他、自由にご記入ください',
}

export const DEFAULT_SCALE_OPTIONS = ['1', '2', '3', '4', '5']

export const isScaleQuestion = (type: LessonSurveyQuestionType): boolean =>
  type === 'COMPREHENSION' || type === 'RESULT_GAP' || type === 'CLARITY' || type === 'JUDGMENT_CHANGED' || type === 'IMPORTANT_INFO'
