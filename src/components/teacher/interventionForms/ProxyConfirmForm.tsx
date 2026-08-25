import { useState } from 'react'
import { Button, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'
import type { LessonResponseView } from '../../../lib/lessonRuns/teacherResponses'
import type { LessonTeamView } from '../../../lib/lessonRuns/teams'
import type { InterventionImpactScope } from '../../../lib/lessonRuns/interventions'
import { findPhaseLabel, type PhaseWithDisplayConfig } from '../../../lib/lessonRuns/phaseLabel'

export interface ProxyConfirmFormProps {
  responses: LessonResponseView[]
  participants: Array<{ id: string; displayName: string }>
  teams: LessonTeamView[]
  phases?: PhaseWithDisplayConfig[]
  onSubmit: (detail: Record<string, unknown>, impactScope: InterventionImpactScope) => void
}

const UNKNOWN_PHASE_LABEL = 'フェーズ名を確認できません'
const UNKNOWN_PARTICIPANT_LABEL = '生徒名を確認できません'
const UNKNOWN_TEAM_LABEL = 'チーム名を確認できません'

function participantLabel(participants: Array<{ id: string; displayName: string }>, participantId: string | undefined): string {
  if (!participantId) return UNKNOWN_PARTICIPANT_LABEL
  const match = participants.find((p) => p.id === participantId)
  const name = match?.displayName.trim()
  return name && name.length > 0 ? name : UNKNOWN_PARTICIPANT_LABEL
}

function teamLabel(teams: LessonTeamView[], teamId: string | undefined): string {
  if (!teamId) return UNKNOWN_TEAM_LABEL
  const match = teams.find((t) => t.id === teamId)
  const name = match?.displayName.trim()
  return name && name.length > 0 ? name : UNKNOWN_TEAM_LABEL
}

interface ResponseOption {
  response: LessonResponseView
  label: string
}

function buildOptions(
  responses: LessonResponseView[],
  participants: Array<{ id: string; displayName: string }>,
  teams: LessonTeamView[],
  phases: PhaseWithDisplayConfig[] | undefined,
): ResponseOption[] {
  const approved = responses.filter((response) => response.status === 'APPROVED')
  const baseLabels = approved.map((response) => {
    const phaseLabel = findPhaseLabel(phases, response.phaseId) ?? UNKNOWN_PHASE_LABEL
    const subjectLabel = response.teamId
      ? teamLabel(teams, response.teamId)
      : participantLabel(participants, response.participantId)
    return `${phaseLabel}・${subjectLabel}`
  })
  const counts = new Map<string, number>()
  for (const label of baseLabels) counts.set(label, (counts.get(label) ?? 0) + 1)
  const seen = new Map<string, number>()
  return approved.map((response, index) => {
    const base = baseLabels[index]
    if ((counts.get(base) ?? 0) <= 1) return { response, label: base }
    const ordinal = (seen.get(base) ?? 0) + 1
    seen.set(base, ordinal)
    return { response, label: `${base}（回答${ordinal}）` }
  })
}

/**
 * 代理確定の専用フォーム。承認済み(APPROVED)の回答だけを対象にし、教師には
 * フェーズ名・生徒名/チーム名などの人間可読ラベルしか出さない。
 * response.id / phaseId / inputId / participantId / teamId は内部の
 * onSubmit ペイロードにのみ渡り、DOM には一切出さない。
 *
 * チームの回答は confirmationMode によって分岐する:
 * - REPRESENTATIVE: team.representativeParticipantId を自動的に
 *   onBehalfOfParticipantId として使う（教師の追加選択なし）。
 * - ALL / QUORUM: 教師がチームメンバーを表示名で選ぶ。
 */
export function ProxyConfirmForm({ responses, participants, teams, phases, onSubmit }: ProxyConfirmFormProps) {
  const [selectedResponse, setSelectedResponse] = useState<LessonResponseView | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)

  const options = buildOptions(responses, participants, teams, phases)

  if (!selectedResponse) {
    if (options.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">確定できる承認済みの回答がありません。</Typography>
      )
    }
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">どの回答を確定しますか？</Typography>
        <List>
          {options.map((option) => (
            <ListItemButton
              key={option.response.id}
              sx={{ minHeight: MIN_TOUCH_TARGET }}
              onClick={() => { setSelectedResponse(option.response); setSelectedMemberId(null) }}
            >
              <ListItemText primary={option.label} />
            </ListItemButton>
          ))}
        </List>
      </Stack>
    )
  }

  const team = selectedResponse.teamId ? teams.find((t) => t.id === selectedResponse.teamId) ?? null : null
  const isTeamResponse = Boolean(selectedResponse.teamId)
  const requiresMemberPick = isTeamResponse && team?.confirmationMode !== 'REPRESENTATIVE'

  const submit = (onBehalfOfParticipantId: string | undefined) => {
    if (!onBehalfOfParticipantId) return
    const detail = {
      phaseId: selectedResponse.phaseId,
      inputId: selectedResponse.inputId,
      onBehalfOfParticipantId,
    }
    const impactScope: InterventionImpactScope = isTeamResponse && selectedResponse.teamId
      ? { level: 'TEAM', teamId: selectedResponse.teamId }
      : { level: 'PARTICIPANT', participantId: onBehalfOfParticipantId }
    onSubmit(detail, impactScope)
    setSelectedResponse(null)
    setSelectedMemberId(null)
  }

  if (requiresMemberPick) {
    if (!selectedMemberId) {
      const memberOptions = (team?.memberParticipantIds ?? []).map((id) => ({
        id,
        label: participantLabel(participants, id),
      }))
      return (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">誰に代わって確定しますか？</Typography>
          {memberOptions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">このチームのメンバー情報を確認できません。</Typography>
          ) : (
            <List>
              {memberOptions.map((option) => (
                <ListItemButton
                  key={option.id}
                  sx={{ minHeight: MIN_TOUCH_TARGET }}
                  onClick={() => setSelectedMemberId(option.id)}
                >
                  <ListItemText primary={option.label} />
                </ListItemButton>
              ))}
            </List>
          )}
          <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setSelectedResponse(null)}>戻る</Button>
        </Stack>
      )
    }
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {participantLabel(participants, selectedMemberId)} に代わってこの回答を確定します。よろしいですか？
        </Typography>
        <Button variant="contained" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => submit(selectedMemberId)}>
          この内容で確定する
        </Button>
        <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setSelectedMemberId(null)}>戻る</Button>
      </Stack>
    )
  }

  const onBehalfOfParticipantId = isTeamResponse
    ? team?.representativeParticipantId
    : selectedResponse.participantId
  const confirmName = participantLabel(participants, onBehalfOfParticipantId)

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {confirmName} に代わってこの回答を確定します。よろしいですか？
      </Typography>
      <Button
        variant="contained"
        sx={{ minHeight: MIN_TOUCH_TARGET }}
        disabled={!onBehalfOfParticipantId}
        onClick={() => submit(onBehalfOfParticipantId)}
      >
        この内容で確定する
      </Button>
      <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setSelectedResponse(null)}>戻る</Button>
    </Stack>
  )
}
