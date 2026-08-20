import { Button, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { PendingTemplateReport } from '../../lib/lessonTemplates/moderationQueue'

export interface OperatorReportsPageProps {
  reports: PendingTemplateReport[]
  loading: boolean
  accessDenied: boolean
  onUnpublish: (report: PendingTemplateReport) => void
  onDismiss: (report: PendingTemplateReport) => void
  onNavigateHome?: () => void
  onNavigateToCertifications?: () => void
  onNavigateToAiBeta?: () => void
}

export function OperatorReportsPage({
  reports,
  loading,
  accessDenied,
  onUnpublish,
  onDismiss,
  onNavigateHome,
  onNavigateToCertifications,
  onNavigateToAiBeta,
}: OperatorReportsPageProps) {
  if (accessDenied) return <Stack sx={{ p: 2 }}><Typography color="error">この画面は運営者のみ利用できます。</Typography></Stack>
  return <Stack spacing={2} sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
      <Typography variant="h5">通報の審査</Typography>
      <Stack direction="row" spacing={1}>
        {onNavigateHome && (
          <Button variant="text" onClick={onNavigateHome}>
            運営者ページへ
          </Button>
        )}
        {onNavigateToCertifications && (
          <Button variant="outlined" onClick={onNavigateToCertifications}>
            教材認定へ
          </Button>
        )}
        {onNavigateToAiBeta && (
          <Button variant="outlined" onClick={onNavigateToAiBeta}>
            AIベータ管理へ
          </Button>
        )}
      </Stack>
    </Stack>
    {loading ? <CircularProgress aria-label="読み込み中" /> : reports.length
      ? <List>{reports.map((report) => <ListItem key={report.id} secondaryAction={<Stack direction="row" spacing={1}><Button color="error" onClick={() => onUnpublish(report)}>非公開化</Button><Button onClick={() => onDismiss(report)}>却下</Button></Stack>}><ListItemText primary={report.templateTitle ?? report.templateId} secondary={report.details ?? report.reason} /></ListItem>)}</List>
      : <Typography color="text.secondary">未対応の通報はありません。</Typography>}
  </Stack>
}
