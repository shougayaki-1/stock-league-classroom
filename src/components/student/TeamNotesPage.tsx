import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { TeamResearchNoteView } from '../../lib/lessonRuns/liveTypes'

export interface TeamNotesPageProps {
  note?: TeamResearchNoteView | null
  onSaveNote: (text: string, expectedRevision: number) => Promise<void>
  disabled?: boolean
}

export function TeamNotesPage({ note, onSaveNote, disabled = false }: TeamNotesPageProps) {
  const [localText, setLocalText] = useState(note?.text ?? '')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [lastServerRevision, setLastServerRevision] = useState(note?.revision ?? 0)

  // When remote revision changes and user hasn't edited or wants to see remote updates
  useEffect(() => {
    if (note && note.revision > lastServerRevision) {
      setLastServerRevision(note.revision)
      // If user had clean state matching old text, update local text to latest
      setLocalText((prev) => (prev === '' ? note.text : prev))
    }
  }, [note, lastServerRevision])

  const handleSave = async () => {
    if (!localText.trim()) return
    setSaving(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const expectedRev = note?.revision ?? 0
      await onSaveNote(localText, expectedRev)
      setSuccessMsg('ノートを保存しました。')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存に失敗しました。'
      if (message.includes('他のメンバー') || message.includes('Revision mismatch')) {
        setErrorMsg('他のメンバーがノートを更新したか、バージョンが一致しません。入力内容を確認して再度保存してください。')
      } else {
        setErrorMsg(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const expectedRevision = note?.revision ?? 0
  const isDirty = localText !== (note?.text ?? '')

  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 720, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2" color="text.secondary">
          チーム共有ノート (リビジョン: {expectedRevision})
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {localText.length} / 5000文字
        </Typography>
      </Box>

      {errorMsg && (
        <Alert severity="warning" onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      <TextField
        label="チームノート"
        multiline
        minRows={8}
        maxRows={18}
        value={localText}
        onChange={(e) => {
          setLocalText(e.target.value)
          setErrorMsg(null)
          setSuccessMsg(null)
        }}
        disabled={disabled || saving}
        placeholder="企業の強みやニュースの考察、チームの投資戦略を共有・記録してください。"
        fullWidth
        slotProps={{
          htmlInput: {
            maxLength: 5000,
          },
        }}
      />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        {note && isDirty && (
          <Button
            variant="text"
            onClick={() => {
              setLocalText(note.text)
              setErrorMsg(null)
            }}
            disabled={saving}
          >
            最新のサーバー内容に戻す
          </Button>
        )}
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={disabled || saving || !localText.trim()}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? '保存中...' : '保存する'}
        </Button>
      </Box>
    </Stack>
  )
}
