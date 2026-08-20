import { useState } from 'react'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { Functions } from 'firebase/functions'
import { issueDisplaySessionToken } from '../../lib/lessonRuns/displaySession'
import { describeError } from '../../lib/monitoring/describeError'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

export interface ClassroomDisplayUrlDialogProps {
  open: boolean
  onClose: () => void
  lessonRunId: string
  functions: Functions
}

export function ClassroomDisplayUrlDialog({
  open,
  onClose,
  lessonRunId,
  functions,
}: ClassroomDisplayUrlDialogProps) {
  const [displayToken, setDisplayToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

  const handleIssueToken = async () => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await issueDisplaySessionToken(functions, { lessonRunId })
      setDisplayToken(result.token)
    } catch (err) {
      setError(describeError(err, '表示用URLの発行に失敗しました。'))
    } finally {
      setLoading(false)
    }
  }

  const displayUrl = displayToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/display/${lessonRunId}?token=${displayToken}`
    : null

  const handleCopy = () => {
    if (!displayUrl) return
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(displayUrl).then(() => setCopied(true))
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>教室表示のURL再発行</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              プロジェクターや電子黒板の再起動などで教室表示が切断された場合、新しい表示用URLを発行できます。
            </Typography>

            {error && <Alert severity="error">{error}</Alert>}

            {displayUrl ? (
              <Stack spacing={2}>
                <TextField
                  label="表示用URL (1回限り有効)"
                  value={displayUrl}
                  fullWidth
                  slotProps={{ input: { readOnly: true } }}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    startIcon={<OpenInNewIcon />}
                    sx={{ minHeight: MIN_TOUCH_TARGET }}
                  >
                    教室表示を開く
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleCopy}
                    startIcon={<ContentCopyIcon />}
                    sx={{ minHeight: MIN_TOUCH_TARGET }}
                  >
                    URLをコピー
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Button
                variant="contained"
                onClick={handleIssueToken}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                sx={{ minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start' }}
              >
                {loading ? '発行中...' : '表示用URLを発行'}
              </Button>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ minHeight: MIN_TOUCH_TARGET }}>
            閉じる
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={copied}
        autoHideDuration={3000}
        onClose={() => setCopied(false)}
        message="表示用URLをクリップボードにコピーしました"
      />
    </>
  )
}
