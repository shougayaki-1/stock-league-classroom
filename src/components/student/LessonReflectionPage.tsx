import { Alert, Button, Divider, Stack, Typography } from '@mui/material'
import type { LessonInputValue, ShortTextConfig, SingleChoiceConfig } from '@stock-league/lesson-inputs'
import { LessonInputRenderer } from '../lessonInputs/LessonInputRenderer'
import {
  DEFAULT_SCALE_OPTIONS, SURVEY_QUESTION_LABELS, isScaleQuestion,
  type LessonReflectionMethod, type LessonSurveyQuestion, type LessonSurveyQuestionType,
} from './lessonReflectionMapping'

export type { LessonReflectionMethod, LessonSurveyQuestion, LessonSurveyQuestionType } from './lessonReflectionMapping'

export interface LessonReflectionPageProps {
  lessonTitle: string
  /** 自分の表示名(§23.6)。 */
  displayName: string
  /** 自チーム名。他チーム名を渡す経路はこのpropsに存在しない。 */
  teamName?: string
  reflectionMethod: LessonReflectionMethod

  // CHOICE_ONLY / SHORT_TEXT / TEAM_DISCUSSION / INDIVIDUAL_THEN_TEAM(個人分)
  inputConfig?: SingleChoiceConfig | ShortTextConfig
  value?: LessonInputValue
  onChange?: (value: LessonInputValue) => void

  // INDIVIDUAL_THEN_TEAM のチーム分のみ使用
  teamInputConfig?: SingleChoiceConfig | ShortTextConfig
  teamValue?: LessonInputValue
  onTeamChange?: (value: LessonInputValue) => void

  // POST_LESSON_SURVEY のみ使用
  surveyQuestions?: LessonSurveyQuestion[]
  surveyAnswers?: Partial<Record<LessonSurveyQuestionType, LessonInputValue>>
  onSurveyAnswerChange?: (type: LessonSurveyQuestionType, value: LessonInputValue) => void
  onSubmitSurvey?: () => void
  surveySubmitted?: boolean
}

/**
 * 生徒の振り返り画面(Task14)。`reflectionMethod`に応じて
 * `LessonInputRenderer`(Task6)またはアンケート専用UIを描画する薄いshell。
 * `LessonPlayPage`と同じく、他チームの情報を渡す経路自体が存在しない設計
 * (§23.6)。Classroomへの自動投稿は実装しない(ブリーフStep4で明示的に
 * スコープ外)。
 */
export function LessonReflectionPage({
  lessonTitle, displayName, teamName, reflectionMethod,
  inputConfig, value, onChange,
  teamInputConfig, teamValue, onTeamChange,
  surveyQuestions, surveyAnswers, onSurveyAnswerChange, onSubmitSurvey, surveySubmitted,
}: LessonReflectionPageProps) {
  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 560, p: 2 }}>
      <Typography variant="h6" component="h1">{lessonTitle} — 振り返り</Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Typography variant="body2">{displayName}</Typography>
        {teamName && <Typography variant="body2" color="text.secondary">{teamName}</Typography>}
      </Stack>

      <Divider />

      {reflectionMethod === 'CHOICE_ONLY' && inputConfig && onChange && (
        <LessonInputRenderer config={inputConfig as SingleChoiceConfig} value={value as string | undefined} onChange={onChange as (v: string) => void} />
      )}

      {reflectionMethod === 'SHORT_TEXT' && inputConfig && onChange && (
        <LessonInputRenderer config={inputConfig as ShortTextConfig} value={value as string | undefined} onChange={onChange as (v: string) => void} />
      )}

      {reflectionMethod === 'TEAM_DISCUSSION' && inputConfig && onChange && (
        <Stack spacing={1}>
          <Typography variant="body2">チームで話し合って、まとめた内容を入力してください。</Typography>
          <LessonInputRenderer config={inputConfig as ShortTextConfig} value={value as string | undefined} onChange={onChange as (v: string) => void} responseScope="TEAM" />
        </Stack>
      )}

      {reflectionMethod === 'INDIVIDUAL_THEN_TEAM' && (
        <Stack spacing={2}>
          {inputConfig && onChange && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">まず自分の考えを入力してください</Typography>
              <LessonInputRenderer config={inputConfig as ShortTextConfig} value={value as string | undefined} onChange={onChange as (v: string) => void} responseScope="INDIVIDUAL" />
            </Stack>
          )}
          {teamInputConfig && onTeamChange && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">次に、チームで話し合った内容を入力してください</Typography>
              <LessonInputRenderer config={teamInputConfig as ShortTextConfig} value={teamValue as string | undefined} onChange={onTeamChange as (v: string) => void} responseScope="TEAM" />
            </Stack>
          )}
        </Stack>
      )}

      {reflectionMethod === 'POST_LESSON_SURVEY' && (
        <Stack spacing={2}>
          {surveySubmitted && <Alert severity="success">アンケートを送信しました。ご協力ありがとうございました。</Alert>}
          {!surveySubmitted && (surveyQuestions ?? []).map((question) => {
            const answer = surveyAnswers?.[question.type]
            const handleChange = (v: LessonInputValue) => onSurveyAnswerChange?.(question.type, v)
            return (
              <Stack key={question.type} spacing={0.5}>
                {isScaleQuestion(question.type)
                  ? (
                    <LessonInputRenderer
                      config={{ type: 'SINGLE_CHOICE', options: question.options ?? DEFAULT_SCALE_OPTIONS }}
                      value={answer as string | undefined}
                      onChange={handleChange as (v: string) => void}
                      label={SURVEY_QUESTION_LABELS[question.type]}
                    />
                  )
                  : (
                    <LessonInputRenderer
                      config={{ type: 'SHORT_TEXT', maxLength: 400 }}
                      value={answer as string | undefined}
                      onChange={handleChange as (v: string) => void}
                      label={SURVEY_QUESTION_LABELS[question.type]}
                    />
                  )}
              </Stack>
            )
          })}
          {!surveySubmitted && onSubmitSurvey && (
            <Button variant="contained" onClick={onSubmitSurvey}>アンケートを送信する</Button>
          )}
        </Stack>
      )}
    </Stack>
  )
}
