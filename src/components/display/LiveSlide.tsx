import { Chip, Divider, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { LessonRunDisplayTeamSummary } from '../../lib/lessonRuns/liveTypes'

export interface LiveSlideProps {
  title: string
  /**
   * フェーズ名・残り秒数: 現行の `LessonRunDisplayState`
   * (functions/src/lessonRuns/projections/displayProjection.ts) は
   * allow-list によりこれらのフィールドをまだ持たない
   * (`lessonRunPublic` 側にのみ存在するが、表示専用セッションの custom
   * token はそちらを読む権限を持たない — database.rules.json 参照)。
   * このコンポーネントはブリーフStep1の要求(フェーズ名・残り時間の表示)
   * を満たせるよう対応済みだが、`ClassroomDisplayPage` は現状これらを
   * `undefined` のまま渡す。将来 projection がこれらを持つようになった
   * 時点で配線するだけで済むよう、あらかじめ optional prop として用意
   * している。
   */
  phaseName?: string
  remainingSeconds?: number | null
  /** 公開情報(ニュース等)。理由は phaseName と同様、現行projectionには未収録。 */
  publicInfo?: string[]
  teams: LessonRunDisplayTeamSummary[]
  teacherGuidance: string | null
}

/** 授業中画面(LIVE mode)。フェーズ名・残り時間・公開情報・匿名集計・案内のみを表示する。個人回答・未提出者・正解は一切扱わない。 */
export function LiveSlide({ title, phaseName, remainingSeconds, publicInfo, teams, teacherGuidance }: LiveSlideProps) {
  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 960, p: 4 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">{title}</Typography>
        {phaseName && <Chip label={phaseName} color="primary" />}
        {typeof remainingSeconds === 'number' && (
          <Chip label={`残り ${remainingSeconds} 秒`} color={remainingSeconds <= 10 ? 'error' : 'default'} />
        )}
      </Stack>

      {publicInfo && publicInfo.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h6">公開情報</Typography>
          <List dense>
            {publicInfo.map((info) => <ListItem key={info}><ListItemText primary={info} /></ListItem>)}
          </List>
        </Stack>
      )}

      <Divider />

      <Stack spacing={1}>
        <Typography variant="h6">チームの状況</Typography>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          {teams.map((team) => (
            <Stack key={team.teamId} spacing={0.5} sx={{ alignItems: 'center', minWidth: 120 }}>
              <Typography variant="subtitle1">{team.displayName}</Typography>
              {team.publicAggregateLabel && <Chip label={team.publicAggregateLabel} />}
            </Stack>
          ))}
        </Stack>
      </Stack>

      {teacherGuidance && (
        <Typography variant="h6" sx={{ mt: 2 }}>{teacherGuidance}</Typography>
      )}
    </Stack>
  )
}
