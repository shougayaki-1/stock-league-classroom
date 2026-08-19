import { Button, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface ExtendTimeFormProps {
  currentPhaseId: string | null
  hasTimer: boolean
  onSubmit: (detail: Record<string, unknown>) => void
}

/**
 * 時間延長の専用フォーム。フェーズIDは画面が購読している現在フェーズを
 * そのまま使い、教師には見せない（教師が知り得ない内部IDのため）。
 */
const CHOICES: Array<{ label: string; seconds: number }> = [
  { label: '+1分', seconds: 60 },
  { label: '+3分', seconds: 180 },
  { label: '+5分', seconds: 300 },
]

export function ExtendTimeForm({ currentPhaseId, hasTimer, onSubmit }: ExtendTimeFormProps) {
  if (!hasTimer || !currentPhaseId) {
    return <Typography variant="body2" color="text.secondary">このフェーズには制限時間がありません。</Typography>
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">いま進行中のフェーズの残り時間を延ばします。</Typography>
      <Stack direction="row" spacing={1}>
        {CHOICES.map((choice) => (
          <Button
            key={choice.seconds}
            variant="outlined"
            sx={{ minHeight: MIN_TOUCH_TARGET }}
            onClick={() => onSubmit({ phaseId: currentPhaseId, additionalSeconds: choice.seconds })}
          >
            {choice.label}
          </Button>
        ))}
      </Stack>
    </Stack>
  )
}
