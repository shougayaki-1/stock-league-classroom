import ContentPasteSearchIcon from '@mui/icons-material/ContentPasteSearch'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { Button, Card, CardContent, Collapse, List, ListItem, Stack, Typography } from '@mui/material'
import { useState } from 'react'

/**
 * Teacher-facing view of `functions/src/lessonRuns/analytics/buildAnalytics.ts`'s
 * `LessonAnalytics` output. Mirrors `student/LessonResultsPage.tsx`'s pattern
 * of defining its own local props shape rather than importing the Functions
 * package's types directly (this frontend package has no dependency on
 * `functions/`) — the caller (a future data-fetching wrapper) is responsible
 * for translating `LessonAnalytics` + a resolved participant/team roster
 * (real names, per §23.6 — teacher screens show real names, same as
 * `ParticipantMonitor`) into these props.
 *
 * §Task 15 brief Step 4's three explicit requirements:
 *  1. Three headline cards at the top: 根拠 (rationale usage),
 *     変更 (judgment change), 理解困難 (comprehension difficulty).
 *  2. クラス → チーム → 個人 drill-down: individual rows are never shown
 *     until their team is explicitly expanded (privacy-by-default — a
 *     teacher scanning the class view sees only aggregate numbers first).
 *  3. Rankings state their denominator (母数) and unanswered count
 *     alongside the ranking itself, so a "上位/下位" list is never read as
 *     more complete than it actually is.
 *
 * NULL vs 0 (matches `buildLessonAnalytics`'s own contract): every aggregate
 * metric renders "データなし" when `null` — a genuine `0` (e.g. "nobody used
 * any reference information") always renders as an explicit "0%"/"0人",
 * never collapsed into the same "no data" bucket.
 */

export interface LessonAnalyticsAggregateView {
  responseCount: number
  confirmedResponseCount: number
  surveyRespondentCount: number
  rationaleInformationUsageRate: number | null
  judgmentChangeCount: number | null
  judgmentChangeRate: number | null
  comprehensionDifficultyCount: number | null
  comprehensionAverage: number | null
  strugglingParticipantCount: number | null
}

export interface LessonAnalyticsIndividualDisplayRow {
  participantId: string
  displayName: string
  teamId?: string
  rationaleInformationCount: number
  judgmentChanged: boolean | null
  comprehensionScore: number | null
  resultGapScore: number | null
  struggling: boolean
}

export interface LessonAnalyticsTeam {
  teamId: string
  teamName: string
}

export interface LessonAnalyticsPageProps {
  lessonTitle: string
  /** 名簿上の想定参加者数。サーベイ回答率の母数として使う(透明性の担保)。 */
  totalParticipantCount: number
  aggregate: LessonAnalyticsAggregateView
  teams: LessonAnalyticsTeam[]
  individualRows: LessonAnalyticsIndividualDisplayRow[]
}

/** `null` -> "データなし"; a real number -> a formatted percentage/count. Keeps the null/0 distinction visible at the rendering boundary, not just in the data layer. */
const formatRate = (value: number | null): string => (value === null ? 'データなし' : `${Math.round(value * 100)}%`)
const formatCount = (value: number | null): string => (value === null ? 'データなし' : `${value}人`)
const formatScore = (value: number | null): string => (value === null ? '未回答' : String(value))

function HeadlineCard({ icon, label, value, sublabel }: { icon: React.ReactNode; label: string; value: string; sublabel: string }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 160 }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          {icon}
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{label}</Typography>
        </Stack>
        <Typography variant="h5">{value}</Typography>
        <Typography variant="body2" color="text.secondary">{sublabel}</Typography>
      </CardContent>
    </Card>
  )
}

function IndividualRow({ row }: { row: LessonAnalyticsIndividualDisplayRow }) {
  return (
    <ListItem sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
      <Typography sx={{ fontWeight: 700 }}>{row.displayName}</Typography>
      <Typography variant="body2">利用情報数: {row.rationaleInformationCount}件 / 理解度: {formatScore(row.comprehensionScore)} / 判断変更: {row.judgmentChanged === null ? '未回答' : row.judgmentChanged ? 'あり' : 'なし'}</Typography>
      {row.struggling && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <HelpOutlineIcon fontSize="small" color="warning" aria-hidden="true" />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>操作でつまずき、教師の支援を受けました</Typography>
        </Stack>
      )}
    </ListItem>
  )
}

function TeamSection({ team, rows }: { team: LessonAnalyticsTeam; rows: LessonAnalyticsIndividualDisplayRow[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <Stack spacing={0.5}>
      <Button
        variant="outlined"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        sx={{ justifyContent: 'space-between' }}
      >
        {team.teamName}({rows.length}人)
      </Button>
      <Collapse in={expanded} unmountOnExit>
        <List aria-label={`${team.teamName}の個票`} dense sx={{ py: 0 }}>
          {rows.map((row) => <IndividualRow key={row.participantId} row={row} />)}
        </List>
      </Collapse>
    </Stack>
  )
}

export function LessonAnalyticsPage({
  lessonTitle, totalParticipantCount, aggregate, teams, individualRows,
}: LessonAnalyticsPageProps) {
  const unansweredSurveyCount = Math.max(totalParticipantCount - aggregate.surveyRespondentCount, 0)

  const ungroupedRows = individualRows.filter((row) => !row.teamId || !teams.some((team) => team.teamId === row.teamId))

  const comprehensionAnswered = individualRows.filter((row) => row.comprehensionScore !== null)
  const comprehensionRanking = [...comprehensionAnswered].sort((a, b) => (a.comprehensionScore ?? 0) - (b.comprehensionScore ?? 0))
  const comprehensionUnanswered = individualRows.length - comprehensionAnswered.length

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 800, p: 2 }}>
      <Typography variant="h6" component="h1">{lessonTitle} — 分析</Typography>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <HeadlineCard
          icon={<ContentPasteSearchIcon fontSize="small" aria-hidden="true" />}
          label="根拠"
          value={formatRate(aggregate.rationaleInformationUsageRate)}
          sublabel={`確定回答 ${aggregate.confirmedResponseCount}件が対象`}
        />
        <HeadlineCard
          icon={<SwapHorizIcon fontSize="small" aria-hidden="true" />}
          label="変更"
          value={formatRate(aggregate.judgmentChangeRate)}
          sublabel={aggregate.judgmentChangeCount === null ? 'データなし' : `${aggregate.judgmentChangeCount}人が判断を変更`}
        />
        <HeadlineCard
          icon={<HelpOutlineIcon fontSize="small" aria-hidden="true" />}
          label="理解困難"
          value={formatCount(aggregate.comprehensionDifficultyCount)}
          sublabel={aggregate.comprehensionAverage === null ? 'データなし' : `平均理解度 ${aggregate.comprehensionAverage.toFixed(1)}`}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary">
        振り返りアンケート回答: {aggregate.surveyRespondentCount} / {totalParticipantCount}人(未回答 {unansweredSurveyCount}人)
      </Typography>

      {aggregate.strugglingParticipantCount !== null && (
        <Typography variant="body2">操作でつまずいた生徒: {aggregate.strugglingParticipantCount}人</Typography>
      )}

      <Stack spacing={1} role="region" aria-label="クラス → チーム → 個人">
        <Typography variant="subtitle1">チーム別の個票(クリックで展開)</Typography>
        {teams.map((team) => (
          <TeamSection key={team.teamId} team={team} rows={individualRows.filter((row) => row.teamId === team.teamId)} />
        ))}
        {ungroupedRows.length > 0 && (
          <TeamSection team={{ teamId: '__ungrouped__', teamName: 'チーム未所属' }} rows={ungroupedRows} />
        )}
      </Stack>

      <Stack spacing={1} role="region" aria-label="理解度ランキング">
        <Typography variant="subtitle1">理解度ランキング(低い順)</Typography>
        <Typography variant="body2" color="text.secondary">母数 {comprehensionAnswered.length}人 / 未回答 {comprehensionUnanswered}人</Typography>
        <List dense sx={{ py: 0 }}>
          {comprehensionRanking.map((row) => (
            <ListItem key={row.participantId}>
              <Typography variant="body2">{row.displayName}: {formatScore(row.comprehensionScore)}</Typography>
            </ListItem>
          ))}
        </List>
      </Stack>
    </Stack>
  )
}
