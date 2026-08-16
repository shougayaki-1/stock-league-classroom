import { Stack, Typography } from '@mui/material'
import { StudentSurfaceCard } from '../ui/StudentUi'
import type { HouseholdClassComparisonPublicView } from '../../lib/lessonRuns/liveTypes'

export interface HouseholdClassComparisonViewProps {
  comparison: HouseholdClassComparisonPublicView
}

const yenFormatter = new Intl.NumberFormat('ja-JP')

/**
 * Task 13: renders Task 12's class-wide `HouseholdClassComparisonPublicView`
 * — the same shape both the student-automatic view
 * (`HouseholdTeamScreen.tsx`, once `lessonRunPublic/{lessonRunId}`'s
 * `householdClassComparison` field appears) and the classroom projector
 * (`ClassroomDisplayPage.tsx`'s `HOUSEHOLD_COMPARISON` mode) hand it.
 *
 * Self-contained and presentational only: this component renders EXACTLY
 * the fields already present on `comparison` (`teamDisplayName`, `profileId`,
 * `profile` — itself already an allow-listed `HouseholdProfilePublicView` —
 * `cashYen`, `totalAssetsYen`, `totalLiabilitiesYen`, `goalDelayedRounds`,
 * `lifeGoalAchievementScore`) and never reaches for any other data source
 * (no additional subscription, no runtime householdId, no member identity).
 * Because the object it receives was already built by an ALLOW-LIST on the
 * server (`buildHouseholdClassComparisonPublicView`, `finalComparison.ts`),
 * privacy here is inherited rather than re-enforced — there is nothing in
 * this component that could leak a forbidden field even if one were added to
 * `comparison` upstream, since every render call below destructures a named
 * field rather than spreading.
 */
export function HouseholdClassComparisonView({ comparison }: HouseholdClassComparisonViewProps) {
  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        クラス全体の比較
      </Typography>
      <Typography variant="body2" color="text.secondary">
        全{comparison.finalRoundCount}ラウンド終了時点の結果です。
      </Typography>

      {comparison.teams.map((team) => (
        <StudentSurfaceCard key={team.teamDisplayName}>
          <Stack spacing={1.5}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{team.teamDisplayName}</Typography>
            <Stack spacing={1}>
              {team.households.map((household) => (
                <Stack
                  key={household.profileId}
                  direction="row"
                  spacing={2}
                  sx={{ flexWrap: 'wrap', borderTop: '1px solid', borderColor: 'divider', pt: 1 }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 96 }}>{household.profile.lifeStage}</Typography>
                  <Typography variant="body2">現金: {yenFormatter.format(household.cashYen)}円</Typography>
                  <Typography variant="body2">総資産: {yenFormatter.format(household.totalAssetsYen)}円</Typography>
                  <Typography variant="body2">負債: {yenFormatter.format(household.totalLiabilitiesYen)}円</Typography>
                  <Typography variant="body2">目標延期: {household.goalDelayedRounds}回</Typography>
                  <Typography variant="body2">達成スコア: {household.lifeGoalAchievementScore}</Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </StudentSurfaceCard>
      ))}
    </Stack>
  )
}
