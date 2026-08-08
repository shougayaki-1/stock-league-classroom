import { Alert, Chip, Divider, Link, Stack, Typography } from '@mui/material'

/**
 * `buildDecisionExplanation`(functions/src/lessonRuns/results/buildResults.ts)
 * の出力をそのまま描画する形。根拠がない場合は同関数が固定文言
 * (「記録された根拠がありません」)を返すので、この画面側は特別扱いしない
 * — 受け取った文字列をそのまま表示するだけでよい。
 */
export interface LessonResultDecisionExplanation {
  whatHappened: string
  whyItHappened: string
  alternative: string
  nextAction: string
}

/**
 * 1件の結果カード。§23.6 のアイデンティティ保護のため、この画面へは
 * 「本人自身の回答」または「本人の所属チームの回答」だけが渡される設計
 * — 呼び出し側が他チームの結果を除外してから渡すこと。このコンポーネント
 * 自体には他チームの結果を除外するロジックはなく(そもそも受け取る props
 * に他チーム分のデータを渡す経路が存在しない)、LessonPlayPage /
 * LessonWaitingPage と同じ「薄い shell」設計を踏襲している。
 */
export interface LessonResultItem {
  responseId: string
  scope: 'participant' | 'team'
  /** 表示用の値(既にformatされた文字列)。 */
  displayValue: string
  decisionExplanation: LessonResultDecisionExplanation
}

export interface LessonResultsPageProps {
  lessonTitle: string
  /** 自分の表示名(§23.6: 自分の名前のみ表示)。 */
  displayName: string
  /** 自チーム名。他チーム名を渡す経路はこのpropsに存在しない。 */
  teamName?: string
  /** 自分/自チームの結果のみ(呼び出し側が既に絞り込み済み)。 */
  results: LessonResultItem[]
  /** 教師が設定した外部課題URL(例: Google Classroomの課題)。表示のみ行い、自動投稿はしない(ブリーフStep4で明示的にスコープ外)。 */
  externalTaskUrl?: string
  /** 教師が設定した外部結果URL(例: 市場結果ダッシュボード)。表示のみ。 */
  externalResultUrl?: string
}

/**
 * 生徒の結果画面(Task14)。`buildAndPersistLessonResult`
 * (functions/src/lessonRuns/results/buildResults.ts)が生成した
 * `LessonResult`から、呼び出し側が本人/自チーム分だけを抜き出して渡す想定。
 * Classroomへの自動投稿ボタンは実装しない — 外部URLはリンクとして表示する
 * だけ(ブリーフStep4で明示的にスコープ外とされている)。
 */
export function LessonResultsPage({
  lessonTitle, displayName, teamName, results, externalTaskUrl, externalResultUrl,
}: LessonResultsPageProps) {
  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 560, p: 2 }}>
      <Typography variant="h6" component="h1">{lessonTitle} — 結果</Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Chip label={displayName} />
        {teamName && <Chip label={teamName} color="primary" variant="outlined" />}
      </Stack>

      {(externalTaskUrl || externalResultUrl) && (
        <Stack spacing={0.5}>
          {externalTaskUrl && (
            <Link href={externalTaskUrl} target="_blank" rel="noopener noreferrer">外部課題を開く</Link>
          )}
          {externalResultUrl && (
            <Link href={externalResultUrl} target="_blank" rel="noopener noreferrer">結果の詳細を開く</Link>
          )}
        </Stack>
      )}

      <Divider />

      {results.length === 0 && (
        <Alert severity="info">まだ結果がありません。</Alert>
      )}

      {results.map((item) => (
        <Stack key={item.responseId} spacing={1} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label={item.scope === 'team' ? 'チームの回答' : '自分の回答'} size="small" />
            <Typography variant="body1">{item.displayValue}</Typography>
          </Stack>
          <Typography variant="body2"><strong>何が起きたか:</strong> {item.decisionExplanation.whatHappened}</Typography>
          <Typography variant="body2"><strong>なぜそうなったか:</strong> {item.decisionExplanation.whyItHappened}</Typography>
          <Typography variant="body2"><strong>他の選択肢:</strong> {item.decisionExplanation.alternative}</Typography>
          <Typography variant="body2"><strong>次にできること:</strong> {item.decisionExplanation.nextAction}</Typography>
        </Stack>
      ))}
    </Stack>
  )
}
