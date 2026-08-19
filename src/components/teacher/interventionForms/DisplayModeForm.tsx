import { Button, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface DisplayModeFormProps {
  currentOverride: string | null
  onSubmit: (detail: Record<string, unknown>) => void
}

/** LessonControlRoom.tsx の DISPLAY_MODE_LABEL と同じ用語を使う。 */
const MODES: Array<{ mode: string; label: string }> = [
  { mode: 'START', label: '開始待機の画面' },
  { mode: 'LIVE', label: '授業中の画面' },
  { mode: 'EXPLANATION', label: '解説の画面' },
  { mode: 'END', label: '終了の画面' },
  { mode: 'HOUSEHOLD_COMPARISON', label: 'クラス比較の画面' },
]

export function DisplayModeForm({ currentOverride, onSubmit }: DisplayModeFormProps) {
  const currentLabel = MODES.find((entry) => entry.mode === currentOverride)?.label

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {currentLabel
          ? `いま「${currentLabel}」に固定しています。`
          : '教室表示は授業の進行に合わせて自動で切り替わっています。'}
      </Typography>
      <Stack spacing={1}>
        {MODES.map((entry) => (
          <Button
            key={entry.mode}
            variant={entry.mode === currentOverride ? 'contained' : 'outlined'}
            sx={{ minHeight: MIN_TOUCH_TARGET }}
            onClick={() => onSubmit({ displayMode: entry.mode })}
          >
            {entry.label}
          </Button>
        ))}
      </Stack>
      {currentOverride && (
        <Button
          variant="text"
          sx={{ minHeight: MIN_TOUCH_TARGET }}
          onClick={() => onSubmit({ displayMode: null })}
        >
          自動に戻す
        </Button>
      )}
    </Stack>
  )
}
