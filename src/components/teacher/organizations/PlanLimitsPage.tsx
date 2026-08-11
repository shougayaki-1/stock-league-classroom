import { Alert, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import type { DowngradeStatus, PlanLimits, PlanLimitsResult } from '../../../lib/organizations/planLimits'

export interface PlanLimitsPageProps { data: PlanLimitsResult | undefined; error: string | undefined; onCheckout?: () => void; checkingOut?: boolean; onManageBilling?: () => void; managingBilling?: boolean }

const rows: { label: string; key: keyof PlanLimits }[] = [
  { label: '同時授業・市場数', key: 'concurrentLessonsAndMarkets' },
  { label: '参加人数', key: 'participants' },
  { label: '教師席', key: 'teacherSeats' },
  { label: 'AIクレジット', key: 'aiCredits' },
  { label: 'テンプレート保存', key: 'templateStorage' },
  { label: '結果保持（日数）', key: 'resultRetentionDays' },
  { label: 'イベント追加枠', key: 'eventExtraCapacity' },
]

const formatDate = (millis: number): string => new Date(millis).toLocaleDateString('ja-JP')

const violationLines = (status: DowngradeStatus): string[] => status.violations.map((violation) => `${violation.label}: ${violation.used} / ${violation.limit}`)

const renderDowngradeStatus = (status: DowngradeStatus) => {
  if (status.state === 'SCHEDULED' && status.pendingPlanChange) {
    return <Alert severity="info">変更予定: {status.pendingPlanChange.planId}（{formatDate(status.pendingPlanChange.effectiveAtMillis)}から適用）</Alert>
  }
  if (status.state === 'GRACE') {
    const remainingDays = status.graceEndsAtMillis == null ? null : Math.max(0, Math.ceil((status.graceEndsAtMillis - Date.now()) / (24 * 60 * 60 * 1_000)))
    return <Alert severity="warning">
      整理猶予中{remainingDays == null ? '' : `（残り${remainingDays}日、${formatDate(status.graceEndsAtMillis!)}まで）`}。
      {violationLines(status).map((line) => <div key={line}>{line}</div>)}
    </Alert>
  }
  if (status.state === 'RESTRICTED') {
    return <Alert severity="error">
      新規作成を停止中です。超過している資源を整理してください。
      {violationLines(status).map((line) => <div key={line}>{line}</div>)}
    </Alert>
  }
  return null
}

export function PlanLimitsPage({ data, error, onCheckout, checkingOut, onManageBilling, managingBilling }: PlanLimitsPageProps) {
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  const downgradeStatus = data.downgradeStatus ?? { state: 'NORMAL' as const, violations: [] }
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">この組織の利用枠</Typography>
      {renderDowngradeStatus(downgradeStatus)}
      <Table size="small">
        <TableHead><TableRow><TableCell>項目</TableCell><TableCell>上限</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell>{data[row.key]}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
      {onCheckout && <Button variant="contained" disabled={checkingOut} onClick={onCheckout} sx={{ alignSelf: 'flex-start' }}>このプランで申し込む</Button>}
      {onManageBilling && <Button variant="outlined" disabled={managingBilling} onClick={onManageBilling} sx={{ alignSelf: 'flex-start' }}>支払い方法の変更・解約</Button>}
    </Stack>
  )
}
