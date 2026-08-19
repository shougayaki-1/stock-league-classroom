import { useState } from 'react'
import { Alert, Button, CircularProgress, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material'
import type { TuningConstantsResponse } from '../../../lib/platformConfig/getTuningConstants'

export interface TuningDashboardPageProps { data: TuningConstantsResponse | undefined; error: string | undefined; onNavigateHome?: () => void }
interface Row { label: string; value: string; meaning: string; definedIn: string }

const socialRows = (data: TuningConstantsResponse): Row[] => [
  { label: '需給感度プリセット', value: JSON.stringify(data.socialStudies.priceSensitivityPresets), meaning: '情報と需給、それぞれの価格への影響度の重み', definedIn: 'functions/src/market/engine/priceCalculation.ts' },
  { label: '市場ノイズ幅（%）', value: String(data.socialStudies.defaultNoiseMagnitudePercent), meaning: '各区間の価格へ加わるランダムな変動幅', definedIn: 'functions/src/market/engine/priceCalculation.ts' },
  { label: '急変警告のしきい値（%）', value: String(data.socialStudies.defaultSuddenChangeWarningThresholdPercent), meaning: 'この変化率を超えると急変警告を出す', definedIn: 'functions/src/market/engine/priceCalculation.ts' },
  { label: '情報の短期影響区間数', value: String(data.socialStudies.shortTermWindowBatches), meaning: 'ニュースの影響が大きい状態を維持する区間数', definedIn: 'functions/src/market/engine/informationImpact.ts' },
  { label: '横ばい判定幅（%）', value: String(data.socialStudies.flatBandPercent), meaning: '予想判定で横ばいと扱う価格変化の範囲', definedIn: 'functions/src/market/predictionCheckpoint.ts' },
  { label: '連鎖切断検知の待機時間（ミリ秒）', value: String(data.socialStudies.stallDetectionThresholdMillis), meaning: '次の区間が処理されないと停止とみなす待機時間', definedIn: 'functions/src/market/chainWatchdog.ts' },
]
const homeRows = (data: TuningConstantsResponse): Row[] => [
  { label: '税・社会保険の合算税率（%）', value: String(data.homeEconomics.taxModelV1RatePercent), meaning: '簡略化した税・社会保険モデルv1の一律税率', definedIn: 'functions/src/homeEconomics/engine/taxAndSocialInsurance.ts' },
  { label: '緊急予備資金の目標月数', value: String(data.homeEconomics.emergencyFundTargetMonths), meaning: '生活費の何か月分で満点評価とするか', definedIn: 'functions/src/homeEconomics/evaluation.ts' },
  { label: '年金の所得代替率（%）', value: String(data.homeEconomics.pensionReplacementRatePercentProvisionalDefault), meaning: '退職前収入に対する年金給付の既定割合', definedIn: 'functions/src/homeEconomics/engine/retirement.ts' },
]

export function TuningDashboardPage({ data, error, onNavigateHome }: TuningDashboardPageProps) {
  const [tab, setTab] = useState(0)
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  const rows = tab === 0 ? socialRows(data) : homeRows(data)
  return <Stack spacing={2} sx={{ p: 2 }}>{onNavigateHome && <Button variant="text" onClick={onNavigateHome} sx={{ alignSelf: 'flex-start' }}>運営者ページへ</Button>}<Typography variant="h5">試運転用パラメータ一覧</Typography><Alert severity="info">これらの値はコードで固定されており、変更するにはソースコードの編集と再デプロイが必要です。</Alert><Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab label="社会科" /><Tab label="家庭科" /></Tabs><Table size="small"><TableHead><TableRow><TableCell>項目</TableCell><TableCell>現在値</TableCell><TableCell>意味</TableCell><TableCell>定義場所</TableCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.label}><TableCell>{row.label}</TableCell><TableCell>{row.value}</TableCell><TableCell>{row.meaning}</TableCell><TableCell><code>{row.definedIn}</code></TableCell></TableRow>)}</TableBody></Table></Stack>
}
