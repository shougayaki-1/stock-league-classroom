/**
 * §振り返りアンケート (Task 14 brief Step 2): 理解度・重視情報・判断変更・
 * 結果との差・改善点・分かりやすさ・自由記述の7種類が振り返りアンケートの
 * 全カタログ。1回のアンケートは必須設問だけで2〜5分に収まることを目安とし
 * (§ "2〜5分を超える必須設問数を拒否する")、上限として5分
 * (`REQUIRED_TIME_BUDGET_SECONDS`)を超える必須設問構成を拒否する。下限の
 * 2分は目安であり(短すぎるアンケートを積極的に拒否する理由が brief にない
 * ため)、このバリデーションでは強制しない — 上限のみを堅く守る。
 */
export type LessonSurveyQuestionType =
  | 'COMPREHENSION'
  | 'IMPORTANT_INFO'
  | 'JUDGMENT_CHANGED'
  | 'RESULT_GAP'
  | 'IMPROVEMENT'
  | 'CLARITY'
  | 'FREE_TEXT'

interface SurveyQuestionCatalogEntry {
  /** この設問1問にかかる平均回答時間の見積もり(秒)。5択スケールは短く、自由記述は長い。 */
  estimatedSeconds: number
  label: string
}

/**
 * 各設問の固定カタログ。新しい種類の追加はこのオブジェクトへの追記のみで
 * 済むよう、`buildLessonSurveySchema`はこのマップからしか妥当性・見積時間
 * を読まない。
 */
export const SURVEY_QUESTION_CATALOG: Record<LessonSurveyQuestionType, SurveyQuestionCatalogEntry> = {
  COMPREHENSION: { estimatedSeconds: 30, label: '授業の内容をどれくらい理解できましたか' },
  IMPORTANT_INFO: { estimatedSeconds: 40, label: '判断する際、どの情報を重視しましたか' },
  JUDGMENT_CHANGED: { estimatedSeconds: 20, label: '途中で判断は変わりましたか' },
  RESULT_GAP: { estimatedSeconds: 45, label: '自分の予想と実際の結果にどれくらい差がありましたか' },
  IMPROVEMENT: { estimatedSeconds: 75, label: '次に活かせる改善点は何ですか' },
  CLARITY: { estimatedSeconds: 20, label: '授業の説明はわかりやすかったですか' },
  FREE_TEXT: { estimatedSeconds: 90, label: '自由記述' },
}

/** §Step2 "2〜5分を超える必須設問数を拒否する": 必須設問の合計見積時間の上限(秒)。 */
export const REQUIRED_TIME_BUDGET_SECONDS = 5 * 60

export interface LessonSurveyQuestionConfig {
  type: LessonSurveyQuestionType
  required: boolean
}

export interface LessonSurveySchema {
  lessonRunId: string
  questions: LessonSurveyQuestionConfig[]
  /** 全設問(必須・任意問わず)の合計見積時間(秒)。UIの目安表示用。 */
  estimatedSeconds: number
}

export interface BuildLessonSurveySchemaInput {
  lessonRunId: string
  questions: LessonSurveyQuestionConfig[]
}

/**
 * アンケートschemaを組み立て、以下を拒否する:
 *  - 空の設問リスト
 *  - カタログにない`type`
 *  - 同じ`type`の重複(FREE_TEXTの重複を含む — 自由記述は1問までという
 *    brief の制約は、FREE_TEXTが元々「型として1種類しか存在しない」設計
 *    なので、一般の重複禁止ルールがそのまま「自由記述1問の上限」を含む)
 *  - 必須設問だけの合計見積時間が`REQUIRED_TIME_BUDGET_SECONDS`(5分)を
 *    超える構成
 */
export const buildLessonSurveySchema = (input: BuildLessonSurveySchemaInput): LessonSurveySchema => {
  if (input.questions.length === 0) {
    throw new Error('Survey must have at least one question')
  }

  const seenTypes = new Set<string>()
  for (const question of input.questions) {
    if (!(question.type in SURVEY_QUESTION_CATALOG)) {
      throw new Error(`Unknown survey question type: ${question.type}`)
    }
    if (seenTypes.has(question.type)) {
      throw new Error(`Duplicate survey question type: ${question.type} (free-text and every other question type may appear at most once)`)
    }
    seenTypes.add(question.type)
  }

  const requiredSeconds = input.questions
    .filter((question) => question.required)
    .reduce((total, question) => total + SURVEY_QUESTION_CATALOG[question.type].estimatedSeconds, 0)
  if (requiredSeconds > REQUIRED_TIME_BUDGET_SECONDS) {
    throw new Error(
      `Required questions are estimated to take ${requiredSeconds}s, exceeding the ${REQUIRED_TIME_BUDGET_SECONDS}s (5分) survey time budget`,
    )
  }

  const estimatedSeconds = input.questions
    .reduce((total, question) => total + SURVEY_QUESTION_CATALOG[question.type].estimatedSeconds, 0)

  return { lessonRunId: input.lessonRunId, questions: input.questions, estimatedSeconds }
}
