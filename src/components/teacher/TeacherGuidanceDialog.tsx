import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import type { Functions } from 'firebase/functions'
import { generateTeacherGuidance } from '../../lib/ai/generateTeacherGuidance'
import { setTeacherGuidance } from '../../lib/lessonRuns/setTeacherGuidance'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'
export interface TeacherGuidanceDialogProps { open: boolean; onClose: () => void; lessonRunId: string; initialGuidance: string | null; functions: Functions; aiEnabled: boolean }
export function TeacherGuidanceDialog({ open, onClose, lessonRunId, initialGuidance, functions, aiEnabled }: TeacherGuidanceDialogProps) {
  const [guidance, setGuidance] = useState(initialGuidance ?? ''); const [topic, setTopic] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (open) setGuidance(initialGuidance ?? '') }, [open, initialGuidance])
  const draft = async () => { setBusy(true); setError(''); try { setGuidance((await generateTeacherGuidance(functions, { topic })).teacherGuidance) } catch { setError('AI下書きに失敗しました。手動で入力してください。') } finally { setBusy(false) } }
  const save = async () => { setBusy(true); setError(''); try { await setTeacherGuidance(functions, { lessonRunId, teacherGuidance: guidance }); onClose() } catch { setError('保存に失敗しました。もう一度お試しください。') } finally { setBusy(false) } }
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"><DialogTitle>説明スライドを編集</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{error && <Alert severity="error">{error}</Alert>}{aiEnabled && <Stack spacing={1}><TextField label="AIに伝えるトピック" value={topic} onChange={(event) => setTopic(event.target.value)} /><Button variant="outlined" disabled={busy || !topic} onClick={() => void draft()} sx={{ minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start' }}>AIで下書き</Button></Stack>}<TextField label="説明スライドの文言" value={guidance} onChange={(event) => setGuidance(event.target.value)} multiline minRows={4} /></Stack></DialogContent><DialogActions><Button onClick={onClose} sx={{ minHeight: MIN_TOUCH_TARGET }}>キャンセル</Button><Button variant="contained" disabled={busy} onClick={() => void save()} sx={{ minHeight: MIN_TOUCH_TARGET }}>保存</Button></DialogActions></Dialog>
}
