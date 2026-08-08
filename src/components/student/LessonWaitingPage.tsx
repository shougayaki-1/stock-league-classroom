import { Alert, Chip, Divider, Stack, Typography } from '@mui/material'
import { QuickPractice } from './QuickPractice'

export interface LessonWaitingPageProps {
  lessonTitle: string
  /** 自チーム名。他チームの情報はこの画面には一切渡されない設計(§23.6)。 */
  teamName?: string
  /** 自分の表示名。 */
  displayName: string
  /** 自チームメンバーの表示名(自分を含めてもよい)。他チームのメンバー名は
   * この props に渡す経路自体が存在しない — 呼び出し側は自チーム分だけを
   * 渡すこと(§23.6: 生徒画面は自分・チームメンバーの名前のみ)。 */
  teamMemberNames?: string[]
  /** Task4で発行された復帰コード。渡された場合、保存確認を表示する。 */
  recoveryCode?: string
  /**
   * `joinLessonRun`(Task3)の`duplicateIdentifierWarning`をそのまま渡されて
   * も、この画面は絶対に表示しない(重複識別番号の警告は教師のみに送る、
   * ブリーフStep1)。値を受け取れるようにしているのは「呼び出し側が誤って
   * 渡しても安全」であることを示すため。
   */
  duplicateIdentifierWarning?: boolean
}

/**
 * 生徒の待機画面(Task12, `WAITING`状態)。チーム/表示名/授業タイトル/
 * 開始案内・30秒操作練習(`QuickPractice`)・復帰コードの保存確認だけを表示
 * する。`QuickPractice`はこのファイルからも本番の回答保存Callableへの経路
 * を一切持たない(props自体に`functions`/`saveResponseDraft`を含めていない)
 * — ブリーフの「WAITING以外では練習回答を本番回答へ保存しない」を、この
 * 画面がそもそもそういう保存経路を持たないことで満たす。
 */
export function LessonWaitingPage({
  lessonTitle, teamName, displayName, teamMemberNames, recoveryCode,
}: LessonWaitingPageProps) {
  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 480, p: 2 }}>
      <Typography variant="h6" component="h1">{lessonTitle}</Typography>
      <Typography variant="body1">開始までしばらくお待ちください。準備ができたら自動的に始まります。</Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Chip label={`表示名: ${displayName}`} />
        {teamName && <Chip label={`チーム: ${teamName}`} color="primary" variant="outlined" />}
      </Stack>

      {teamMemberNames && teamMemberNames.length > 0 && (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">チームメンバー</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {teamMemberNames.map((name) => <Chip key={name} label={name} size="small" />)}
          </Stack>
        </Stack>
      )}

      {recoveryCode && (
        <Alert severity="info">
          復帰コードを保存しました: <strong>{recoveryCode}</strong>
          。接続が切れても、この番号でこの端末以外からでも再開できます。
        </Alert>
      )}

      <Divider />

      <QuickPractice />
    </Stack>
  )
}
