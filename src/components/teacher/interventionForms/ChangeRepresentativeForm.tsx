import { useState } from 'react'
import { Button, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'
import type { LessonTeamView } from '../../../lib/lessonRuns/teams'

export interface ChangeRepresentativeFormProps {
  teams: LessonTeamView[]
  participants: Array<{ id: string; displayName: string }>
  onSubmit: (detail: Record<string, unknown>) => void
}

const UNKNOWN_TEAM_LABEL = 'チーム名を確認できません'
const UNKNOWN_PARTICIPANT_LABEL = '生徒名を確認できません'

function participantLabel(participants: Array<{ id: string; displayName: string }>, participantId: string): string {
  const match = participants.find((p) => p.id === participantId)
  const name = match?.displayName.trim()
  return name && name.length > 0 ? name : UNKNOWN_PARTICIPANT_LABEL
}

/**
 * 代表者変更の専用フォーム。表示名だけでチーム→交代候補の2段階選択を行う。
 * 現在の代表者は交代候補に出さない。候補が居ない（メンバーが代表者のみの）
 * チームは理由を示して送信を無効化する。team.id / participantId は
 * onSubmit の detail にのみ渡り、DOM には出さない。
 */
export function ChangeRepresentativeForm({ teams, participants, onSubmit }: ChangeRepresentativeFormProps) {
  const [selectedTeam, setSelectedTeam] = useState<LessonTeamView | null>(null)

  if (!selectedTeam) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">どのチームの代表者を変更しますか？</Typography>
        <List>
          {teams.map((team) => {
            const label = team.displayName.trim() || UNKNOWN_TEAM_LABEL
            return (
              <ListItemButton
                key={team.id}
                sx={{ minHeight: MIN_TOUCH_TARGET }}
                onClick={() => setSelectedTeam(team)}
              >
                <ListItemText primary={label} />
              </ListItemButton>
            )
          })}
        </List>
      </Stack>
    )
  }

  const teamLabel = selectedTeam.displayName.trim() || UNKNOWN_TEAM_LABEL
  const candidateIds = selectedTeam.memberParticipantIds.filter((id) => id !== selectedTeam.representativeParticipantId)

  if (candidateIds.length === 0) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {teamLabel}には現在の代表者以外のメンバーがいないため、代表者を変更できません。
        </Typography>
        <Button variant="contained" sx={{ minHeight: MIN_TOUCH_TARGET }} disabled>
          この代表者に変更する
        </Button>
        <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setSelectedTeam(null)}>戻る</Button>
      </Stack>
    )
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">{teamLabel}の新しい代表者を選んでください。</Typography>
      <List>
        {candidateIds.map((participantId) => (
          <ListItemButton
            key={participantId}
            sx={{ minHeight: MIN_TOUCH_TARGET }}
            onClick={() => onSubmit({ teamId: selectedTeam.id, newRepresentativeParticipantId: participantId })}
          >
            <ListItemText primary={participantLabel(participants, participantId)} />
          </ListItemButton>
        ))}
      </List>
      <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setSelectedTeam(null)}>戻る</Button>
    </Stack>
  )
}
