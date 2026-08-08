import { Divider, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { LessonRunDisplayTeamSummary } from '../../lib/lessonRuns/liveTypes'

export interface EndSlideProps {
  title: string
  /** 結果・観点別ランキング。現行projectionは1つの `publicAggregateLabel`(既に匿名化・公開済みの単一文字列)しか持たないため、観点別ランキングはこのラベル文字列内に折り込まれる想定(例: "1位 / 資産120万円")。複数観点を別々の列で持つには displayProjection.ts 側の拡張が必要(このタスクのスコープ外)。 */
  teams: LessonRunDisplayTeamSummary[]
  /**
   * 出来事・因果・振り返り問い: `LessonRunDisplayState` にはまだ専用
   * フィールドがない(allow-list対象外)。将来 projection が拡張された
   * ときにそのまま配線できるよう optional prop として用意しているが、
   * `ClassroomDisplayPage` は現状これらを渡さない(concerns参照)。
   */
  events?: string[]
  causalExplanation?: string
  reflectionQuestions?: string[]
  teacherGuidance: string | null
}

/** 終了画面(END mode)。結果・観点別ランキング・出来事・因果・振り返り問いのみを表示する。本名・個人回答・内部係数は一切扱わない。 */
export function EndSlide({ title, teams, events, causalExplanation, reflectionQuestions, teacherGuidance }: EndSlideProps) {
  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 960, p: 4 }}>
      <Typography variant="h3" component="h1">{title}</Typography>

      <Stack spacing={1}>
        <Typography variant="h6">結果・ランキング</Typography>
        <List>
          {teams.map((team) => (
            <ListItem key={team.teamId}>
              <ListItemText primary={team.displayName} secondary={team.publicAggregateLabel ?? undefined} />
            </ListItem>
          ))}
        </List>
      </Stack>

      {events && events.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h6">授業中に起きた出来事</Typography>
          <List dense>
            {events.map((event) => <ListItem key={event}><ListItemText primary={event} /></ListItem>)}
          </List>
        </Stack>
      )}

      {causalExplanation && (
        <Stack spacing={1}>
          <Typography variant="h6">なぜそうなったのか</Typography>
          <Typography variant="body1">{causalExplanation}</Typography>
        </Stack>
      )}

      {reflectionQuestions && reflectionQuestions.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h6">振り返ってみよう</Typography>
          <List dense>
            {reflectionQuestions.map((question) => <ListItem key={question}><ListItemText primary={question} /></ListItem>)}
          </List>
        </Stack>
      )}

      {teacherGuidance && (
        <>
          <Divider />
          <Typography variant="h6">{teacherGuidance}</Typography>
        </>
      )}
    </Stack>
  )
}
