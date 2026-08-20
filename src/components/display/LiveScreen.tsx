import { Chip, Divider, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { LessonRunDisplayTeamSummary } from '../../lib/lessonRuns/liveTypes'
import { PhaseCountdown } from '../ui/PhaseCountdown'

export interface LiveScreenProps {
  title: string
  /** 現在フェーズの日本語名。`LessonRunDisplayState.currentPhaseLabel` から渡る。 */
  phaseName?: string
  /** 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null。 */
  endsAtMillis?: number | null
  /** 公開情報(ニュース等)。`LessonRunDisplayState` はまだこのフィールドを持たない。 */
  publicInfo?: string[]
  teams: LessonRunDisplayTeamSummary[]
  teacherGuidance: string | null
}

/** 授業中画面(LIVE mode)。フェーズ名・残り時間・公開情報・匿名集計・案内のみを表示する。個人回答・未提出者・正解は一切扱わない。 */
export function LiveScreen({ title, phaseName, endsAtMillis, publicInfo, teams, teacherGuidance }: LiveScreenProps) {
  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 960, p: 4, mx: 'auto' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">{title}</Typography>
        {phaseName && <Chip label={phaseName} color="primary" />}
        <PhaseCountdown endsAtMillis={endsAtMillis} />
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
