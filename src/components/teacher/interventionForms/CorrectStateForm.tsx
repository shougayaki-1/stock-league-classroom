import { useState } from 'react'
import { Button, List, ListItemButton, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface CorrectStateFormProps {
  participants: Array<{ id: string; displayName: string }>
  teams: Array<{ teamId: string; displayName: string }>
  onSubmit: (detail: Record<string, unknown>) => void
}

type Target = 'PARTICIPANT_DISPLAY_NAME' | 'TEAM_DISPLAY_NAME'

/**
 * 状態の手動修正の専用フォーム。サーバの許可リスト
 * (interventions/correctState.ts の CORRECT_STATE_TARGETS) と同じ2種類だけを
 * 出す。対象パスの手入力は存在しない。
 */
export function CorrectStateForm({ participants, teams, onSubmit }: CorrectStateFormProps) {
  const [target, setTarget] = useState<Target | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')

  if (!target) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">何を直しますか？</Typography>
        <Button variant="outlined" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTarget('PARTICIPANT_DISPLAY_NAME')}>生徒の表示名</Button>
        <Button variant="outlined" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTarget('TEAM_DISPLAY_NAME')}>チーム名</Button>
      </Stack>
    )
  }

  const fallbackLabel = target === 'PARTICIPANT_DISPLAY_NAME' ? '生徒名を確認できません' : 'チーム名を確認できません'
  const options = target === 'PARTICIPANT_DISPLAY_NAME'
    ? participants.map((item) => ({ id: item.id, label: item.displayName.trim() || fallbackLabel }))
    : teams.map((item) => ({ id: item.teamId, label: item.displayName.trim() || fallbackLabel }))

  if (!targetId) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">どれを直しますか？</Typography>
        <List>
          {options.map((option) => (
            <ListItemButton
              key={option.id}
              sx={{ minHeight: MIN_TOUCH_TARGET }}
              onClick={() => { setTargetId(option.id); setDisplayName(option.label === fallbackLabel ? '' : option.label) }}
            >
              <ListItemText primary={option.label} />
            </ListItemButton>
          ))}
        </List>
        <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTarget(null)}>戻る</Button>
      </Stack>
    )
  }

  return (
    <Stack spacing={1}>
      <TextField
        id="correct-state-display-name"
        label="新しい名前"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        helperText="1〜50文字"
      />
      <Button
        variant="contained"
        sx={{ minHeight: MIN_TOUCH_TARGET }}
        disabled={displayName.trim().length < 1 || displayName.trim().length > 50}
        onClick={() => onSubmit({ target, targetId, displayName: displayName.trim() })}
      >
        この名前に直す
      </Button>
      <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTargetId(null)}>戻る</Button>
    </Stack>
  )
}
