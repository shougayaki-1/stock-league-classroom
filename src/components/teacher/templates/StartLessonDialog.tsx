import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'

export interface StartLessonDialogProps {
  open: boolean
  onClose: () => void
  onStart: (expectedParticipants: number) => void
  starting: boolean
  error?: string
}

const MIN_PARTICIPANTS = 1
const MAX_PARTICIPANTS = 80

export function StartLessonDialog({ open, onClose, onStart, starting, error }: StartLessonDialogProps) {
  const [expectedParticipants, setExpectedParticipants] = useState(30)
  const inRange = expectedParticipants >= MIN_PARTICIPANTS && expectedParticipants <= MAX_PARTICIPANTS

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>この教材で授業を開始</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="想定人数"
          type="number"
          value={expectedParticipants}
          onChange={(e) => setExpectedParticipants(Number(e.target.value))}
          slotProps={{ htmlInput: { min: MIN_PARTICIPANTS, max: MAX_PARTICIPANTS } }}
          helperText={`${MIN_PARTICIPANTS}〜${MAX_PARTICIPANTS}人`}
          fullWidth
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={starting}>キャンセル</Button>
        <Button
          variant="contained"
          disabled={starting || !inRange}
          onClick={() => onStart(expectedParticipants)}
        >
          開始する
        </Button>
      </DialogActions>
    </Dialog>
  )
}
