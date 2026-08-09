import { Alert, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import type { PlanLimits } from '../../../lib/organizations/planLimits'

export interface PlanLimitsPageProps { data: PlanLimits | undefined; error: string | undefined; onCheckout?: () => void; checkingOut?: boolean }

const rows: { label: string; key: keyof PlanLimits }[] = [
  { label: '同時授業・市場数', key: 'concurrentLessonsAndMarkets' },
  { label: '参加人数', key: 'participants' },
  { label: '教師席', key: 'teacherSeats' },
  { label: 'AIクレジット', key: 'aiCredits' },
  { label: 'テンプレート保存', key: 'templateStorage' },
  { label: '結果保持（日数）', key: 'resultRetentionDays' },
  { label: 'イベント追加枠', key: 'eventExtraCapacity' },
]

export function PlanLimitsPage({ data, error, onCheckout, checkingOut }: PlanLimitsPageProps) {
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">この組織の利用枠</Typography>
      <Table size="small">
        <TableHead><TableRow><TableCell>項目</TableCell><TableCell>上限</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell>{data[row.key]}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
      {onCheckout && <Button variant="contained" disabled={checkingOut} onClick={onCheckout} sx={{ alignSelf: 'flex-start' }}>このプランで申し込む</Button>}
    </Stack>
  )
}
