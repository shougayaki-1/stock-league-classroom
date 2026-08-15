import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { Functions } from 'firebase/functions'
import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'
import type { AiBetaUiState } from '../../../lib/ai/betaAccess'
import { describeError } from '../../../lib/monitoring/describeError'
import { buildDraftFromAnswers } from '../../../lib/lessonTemplates/guidedBuilderPresets'
import type { GuidedBuilderTier, WizardAnswers } from '../../../lib/lessonTemplates/guidedBuilderTypes'
import type { LessonContent } from '../../../lib/lessonTemplates/types'

const labels: Record<GuidedBuilderTier, string> = {
  EASY: '簡易案',
  STANDARD: '標準案',
  ADVANCED: '発展案',
}

export interface TemplateOverviewPageProps {
  answers: WizardAnswers
  onCreate: (draft: LessonContent) => void
  creating: boolean
  functions: Functions
  aiEnabled: boolean
  aiBetaState: AiBetaUiState
}

export function TemplateOverviewPage({
  answers,
  onCreate,
  creating,
  functions,
  aiEnabled,
  aiBetaState,
}: TemplateOverviewPageProps) {
  const drafts = useMemo(
    () =>
      (['EASY', 'STANDARD', 'ADVANCED'] as const).map((tier) => ({
        tier,
        draft: buildDraftFromAnswers(answers, tier),
      })),
    [answers],
  )
  const [chosen, setChosen] = useState<LessonContent>()
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string>()

  const isApproved = aiBetaState === 'APPROVED'
  const isLocked = aiBetaState === 'LOCKED'
  const isBetaLoading = aiBetaState === 'LOADING'
  const isBetaError = aiBetaState === 'ERROR'

  const chooseAi = async () => {
    if (!isApproved) return
    setAiLoading(true)
    setAiError(undefined)
    try {
      const ai = await generateLessonDraft(functions, {
        theme: answers.theme,
        mainObjective: answers.mainObjective,
        subject: answers.goal === 'MARKET_AND_INVESTING' ? 'SOCIAL_STUDIES' : 'HOME_ECONOMICS',
        difficulty: answers.difficulty,
      })
      setChosen({ ...buildDraftFromAnswers(answers, 'STANDARD'), ...ai })
    } catch (error) {
      setAiError(describeError(error, 'AI提案の生成に失敗しました。固定の案をご利用ください。'))
    } finally {
      setAiLoading(false)
    }
  }

  if (!chosen) {
    return (
      <Stack spacing={2}>
        <Typography variant="h6">3つの案から選んでください</Typography>
        {isBetaError && (
          <Alert severity="warning">
            AIベータの利用状態を確認できません。再読み込みしてもう一度お試しください。
          </Alert>
        )}
        {aiError && <Alert severity="warning">{aiError}</Alert>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {drafts.map(({ tier, draft }) => (
            <Card key={tier} sx={{ flex: 1 }}>
              <CardActionArea
                aria-label={`${labels[tier]}を選ぶ`}
                onClick={() => setChosen(draft)}
              >
                <CardContent>
                  <Typography sx={{ fontWeight: 700 }}>{labels[tier]}</Typography>
                  <Typography variant="body2">{draft.title}</Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
          {aiEnabled && (
            <Card sx={{ flex: 1 }}>
              <CardActionArea
                aria-label={isLocked ? 'AI提案（限定ベータ）' : 'AI提案を選ぶ'}
                onClick={chooseAi}
                disabled={!isApproved || aiLoading || isBetaLoading}
              >
                <CardContent>
                  <Typography sx={{ fontWeight: 700 }}>
                    {isLocked ? 'AI提案（限定ベータ）' : 'AI提案'}
                  </Typography>
                  {isLocked ? (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                      現在この機能は限定公開です。{'\n'}利用には運営者による許可が必要です。
                    </Typography>
                  ) : (
                    <Typography variant="body2">
                      条件に合わせたタイトルと説明を提案します。
                    </Typography>
                  )}
                  {(aiLoading || isBetaLoading) && (
                    <CircularProgress size={20} aria-label="AI提案を生成中" sx={{ mt: 1 }} />
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          )}
        </Stack>
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6">授業概要</Typography>
      <TextField
        label="タイトル"
        value={chosen.title}
        onChange={(e) => setChosen({ ...chosen, title: e.target.value })}
      />
      <TextField
        label="説明"
        value={chosen.description}
        onChange={(e) => setChosen({ ...chosen, description: e.target.value })}
        multiline
        minRows={2}
      />
      <Typography variant="body2">
        科目: {chosen.subject === 'SOCIAL_STUDIES' ? '社会科' : '家庭科'}
      </Typography>
      <Button variant="contained" disabled={creating} onClick={() => onCreate(chosen)}>
        この内容で作成
      </Button>
      <Button onClick={() => setChosen(undefined)}>案の選択に戻る</Button>
    </Stack>
  )
}
