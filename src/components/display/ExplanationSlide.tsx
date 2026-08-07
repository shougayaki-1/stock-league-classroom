import { Chip, Divider, Stack, Typography } from '@mui/material'
import type { LessonRunDisplayTeamSummary } from '../../lib/lessonRuns/liveTypes'

const RESUME_HINT: Record<'LIVE' | 'END', string> = {
  LIVE: '授業中の画面に戻ります',
  END: '結果画面に戻ります',
}

export interface ExplanationSlideProps {
  title: string
  teams: LessonRunDisplayTeamSummary[]
  teacherGuidance: string | null
  /**
   * サーバーの `deriveDisplayMode` (displayProjection.ts) は
   * status='REFLECTION' を EXPLANATION に写像する純粋関数のため、
   * どの画面から補足説明に入ったかという情報は `LessonRunDisplayState`
   * 自体には残らない。`ClassroomDisplayPage` がクライアント側で
   * 直前の非EXPLANATIONモード(LIVE/END)を保持し、ここへ渡すことで
   * 「戻るボタンや自動遷移で元のmodeのコンテキストを失わない」
   * (ブリーフStep1)を満たす。まだ一度もLIVE/ENDを観測していない
   * (初回状態がいきなりEXPLANATIONだった)場合は null。
   */
  previousMode: 'LIVE' | 'END' | null
}

/** 説明画面(EXPLANATION mode)。教師の補足説明・チームの匿名集計のみを表示し、直前mode(LIVE/END)への復帰見込みをテキストで示す。 */
export function ExplanationSlide({ title, teams, teacherGuidance, previousMode }: ExplanationSlideProps) {
  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 960, p: 4 }}>
      <Typography variant="h4" component="h1">{title}</Typography>

      {teacherGuidance && <Typography variant="h5">{teacherGuidance}</Typography>}

      {teams.length > 0 && (
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          {teams.map((team) => (
            <Stack key={team.teamId} spacing={0.5} sx={{ alignItems: 'center', minWidth: 120 }}>
              <Typography variant="subtitle1">{team.displayName}</Typography>
              {team.publicAggregateLabel && <Chip label={team.publicAggregateLabel} />}
            </Stack>
          ))}
        </Stack>
      )}

      {previousMode && (
        <>
          <Divider />
          <Typography variant="body2" color="text.secondary">{RESUME_HINT[previousMode]}</Typography>
        </>
      )}
    </Stack>
  )
}
