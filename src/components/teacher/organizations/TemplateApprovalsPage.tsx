import { Alert, Button, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { PendingTemplateApproval } from '../../../lib/lessonTemplates/templateApprovals'

export interface TemplateApprovalsPageProps {
  data: PendingTemplateApproval[] | undefined
  error: string | undefined
  onApprove: (templateId: string) => void
  onReject: (templateId: string) => void
}

export function TemplateApprovalsPage({ data, error, onApprove, onReject }: TemplateApprovalsPageProps) {
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">承認待ちテンプレート</Typography>
      {data.length === 0
        ? <Typography color="text.secondary">承認待ちのテンプレートはありません。</Typography>
        : <List>
            {data.map((item) => (
              <ListItem key={item.id} secondaryAction={
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={() => onApprove(item.id)}>承認</Button>
                  <Button variant="outlined" color="error" onClick={() => onReject(item.id)}>却下</Button>
                </Stack>
              }>
                <ListItemText primary={item.title} secondary={`作成者: ${item.createdByUid}`} />
              </ListItem>
            ))}
          </List>}
    </Stack>
  )
}
