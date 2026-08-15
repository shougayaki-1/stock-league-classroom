import { useState } from 'react'
import { Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'

export type TemplateReportReason = 'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'
const REPORT_REASONS: Array<{ value: TemplateReportReason; label: string }> = [
  { value: 'PERSONAL_INFO', label: '個人情報' },
  { value: 'COPYRIGHT', label: '著作権' },
  { value: 'INAPPROPRIATE', label: '不適切な内容' },
  { value: 'MISINFORMATION', label: '誤った情報' },
  { value: 'OTHER', label: 'その他' },
]

const VISIBILITY_LABELS: Record<string, string> = {
  COMMUNITY: '通常公開',
  VERIFIED: '認証済み',
  OFFICIAL: '公式',
}

const VISIBILITY_COLORS: Record<string, 'default' | 'primary' | 'secondary'> = {
  COMMUNITY: 'default',
  VERIFIED: 'primary',
  OFFICIAL: 'secondary',
}

export interface CommunityTemplatesPageProps {
  templates: CommunityTemplate[]
  loading: boolean
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined
  onSubjectChange: (subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined) => void
  onDuplicate: (template: CommunityTemplate) => void
  onReport: (template: CommunityTemplate, reason: TemplateReportReason, details: string) => void
  onOpenDetail: (template: CommunityTemplate) => void
}

export function CommunityTemplatesPage({ templates, loading, subject, onSubjectChange, onDuplicate, onReport, onOpenDetail }: CommunityTemplatesPageProps) {
  const [reportTarget, setReportTarget] = useState<CommunityTemplate>()
  const [reason, setReason] = useState<TemplateReportReason>()
  const [details, setDetails] = useState('')
  const closeDialog = () => { setReportTarget(undefined); setReason(undefined); setDetails('') }
  return <Stack spacing={2} sx={{ p: 2 }}>
    <Typography variant="h5">教材マーケットプレイス</Typography>
    <ToggleButtonGroup exclusive value={subject ?? null} onChange={(_event, value) => onSubjectChange(value ?? undefined)}>
      <ToggleButton value="SOCIAL_STUDIES">公民</ToggleButton>
      <ToggleButton value="HOME_ECONOMICS">家庭科</ToggleButton>
    </ToggleButtonGroup>
    {loading ? <CircularProgress aria-label="読み込み中" /> : templates.length
      ? <List>{templates.map((template) => <ListItem key={template.id} secondaryAction={<Stack direction="row" spacing={1}><Button variant="outlined" onClick={() => onDuplicate(template)}>自組織へ複製</Button><Button color="error" onClick={() => setReportTarget(template)}>通報</Button></Stack>}><ListItemText primary={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Button variant="text" onClick={() => onOpenDetail(template)} sx={{ p: 0, textTransform: 'none' }}>{template.title}</Button><Chip label={VISIBILITY_LABELS[template.visibility ?? 'COMMUNITY'] ?? '通常公開'} color={VISIBILITY_COLORS[template.visibility ?? 'COMMUNITY'] ?? 'default'} size="small" /></Stack>} secondary={template.description} /></ListItem>)}</List>
      : <Typography color="text.secondary">公開されている教材がまだありません。</Typography>}
    <Dialog open={!!reportTarget} onClose={closeDialog}>
      <DialogTitle>教材を通報</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {REPORT_REASONS.map((item) => <ToggleButton key={item.value} value={item.value} selected={reason === item.value} onChange={() => setReason(item.value)}>{item.label}</ToggleButton>)}
          </Stack>
          <TextField label="詳細(任意)" value={details} onChange={(event) => setDetails(event.target.value)} multiline minRows={2} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={closeDialog}>キャンセル</Button>
        <Button variant="contained" disabled={!reason} onClick={() => { if (reportTarget && reason) { onReport(reportTarget, reason, details); closeDialog() } }}>送信</Button>
      </DialogActions>
    </Dialog>
  </Stack>
}

