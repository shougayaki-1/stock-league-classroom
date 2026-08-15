import { Alert, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material'
import type { OrgUsageDashboard } from '../../../lib/organizations/usageDashboard'

export interface UsageDashboardPageProps {
  data: OrgUsageDashboard | undefined
  error: string | undefined
}

export function UsageDashboardPage({ data, error }: UsageDashboardPageProps) {
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">利用状況ダッシュボード</Typography>
      <Card>
        <CardContent>
          <Typography variant="subtitle1">授業実施件数</Typography>
          <Typography variant="body2">今月: {data.lessonRunsThisMonth}件</Typography>
          <Typography variant="body2">累積: {data.lessonRunsTotal}件</Typography>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="subtitle1">同時実施数</Typography>
          <Typography variant="body2">{data.concurrentActive} / {data.concurrentLimit}</Typography>
          {data.concurrentActive >= data.concurrentLimit && <Alert severity="warning">上限に達しています</Alert>}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="subtitle1">AI利用枠</Typography>
          <Typography variant="body2">本日: {data.aiDailyUsed} / {data.aiDailyLimit}</Typography>
          {data.aiDailyUsed >= data.aiDailyLimit && <Alert severity="warning">本日の上限に達しています</Alert>}
          <Typography variant="body2">今月: {data.aiMonthlyUsed} / {data.aiMonthlyLimit}</Typography>
          {data.aiMonthlyUsed >= data.aiMonthlyLimit && <Alert severity="warning">今月の上限に達しています</Alert>}
        </CardContent>
      </Card>
    </Stack>
  )
}
