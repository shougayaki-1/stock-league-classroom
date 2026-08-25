import { useState } from 'react'
import { Box, Button, Drawer, List, ListItemButton, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { canApplyIntervention, type InterventionImpactScope, type LessonInterventionType } from '../../lib/lessonRuns/interventions'
import type { LessonRunRole } from '../../lib/lessonRuns/authorization'
import type { LessonResponseView } from '../../lib/lessonRuns/teacherResponses'
import type { LessonTeamView } from '../../lib/lessonRuns/teams'
import type { PhaseWithDisplayConfig } from '../../lib/lessonRuns/phaseLabel'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'
import { ExtendTimeForm } from './interventionForms/ExtendTimeForm'
import { DisplayModeForm } from './interventionForms/DisplayModeForm'
import { HideInformationForm } from './interventionForms/HideInformationForm'
import { CorrectStateForm } from './interventionForms/CorrectStateForm'
import { ProxyConfirmForm } from './interventionForms/ProxyConfirmForm'

interface DetailFieldSpec {
  key: string
  label: string
}

interface InterventionCatalogEntry {
  label: string
  description: string
  fields: DetailFieldSpec[]
}

/**
 * The 9 §6.5 mid-lesson interventions (Task 9's `lessonInterventionTypes`),
 * with a Japanese label/description and the `detail` fields the Callable
 * requires (functions/src/lessonRuns/interventions.ts's
 * `REQUIRED_DETAIL_KEYS`) rendered generically as text fields. A bespoke
 * form per intervention type (e.g. a participant picker instead of a raw ID
 * field) is out of this task's scope — the Callable itself validates
 * `detail` server-side, so a generic field here is correct, just not the
 * most polished data-entry UX.
 */
const INTERVENTION_CATALOG: Record<LessonInterventionType, InterventionCatalogEntry> = {
  EXTEND_TIME: {
    label: '時間を延ばす', description: 'いま進行中のフェーズの残り時間を延ばします',
    fields: [],
  },
  PROXY_CONFIRM: {
    label: '代理確定', description: '生徒に代わって回答を確定します',
    fields: [],
  },
  CHANGE_REPRESENTATIVE: {
    label: '代表者変更', description: 'チームの代表者を変更します',
    fields: [{ key: 'teamId', label: 'チームID' }, { key: 'newRepresentativeParticipantId', label: '新代表者の参加者ID' }],
  },
  RECONNECT_PARTICIPANT: {
    label: '参加者の再接続', description: '参加者を新しい端末に再接続します',
    fields: [{ key: 'participantId', label: '参加者ID' }, { key: 'newAuthUid', label: '新しい認証UID' }],
  },
  SWITCH_DISPLAY_MODE: {
    label: '教室表示の画面を切り替える', description: '教室に投影している画面を手動で切り替えます',
    fields: [],
  },
  CORRECT_STATE: {
    label: '名前を直す', description: '生徒の表示名やチーム名の打ち間違いを直します',
    fields: [],
  },
  RESTORE_PREVIOUS_PHASE: {
    label: '前フェーズへ復元', description: '直前のフェーズへ戻します',
    fields: [{ key: 'targetPhaseId', label: '戻し先フェーズID' }],
  },
  EMERGENCY_STOP: {
    label: '緊急停止', description: '授業を直ちに安全停止します',
    fields: [],
  },
  HIDE_INFORMATION: {
    label: '情報を隠す', description: '公開済みのニュースを一時的に非表示にします',
    fields: [],
  },
}

const INTERVENTION_ORDER: LessonInterventionType[] = [
  'EXTEND_TIME', 'PROXY_CONFIRM', 'CHANGE_REPRESENTATIVE', 'RECONNECT_PARTICIPANT',
  'SWITCH_DISPLAY_MODE', 'CORRECT_STATE', 'RESTORE_PREVIOUS_PHASE', 'EMERGENCY_STOP', 'HIDE_INFORMATION',
]

export interface InterventionApplyInput {
  type: LessonInterventionType
  reason: string
  detail: Record<string, unknown>
  impactScope?: InterventionImpactScope
}

export interface InterventionPanelProps {
  open: boolean
  onClose: () => void
  role: LessonRunRole
  currentPhaseId: string | null
  phaseHasTimer: boolean
  displayModeOverride: string | null
  informationItems: Array<{ id: string; body: string }>
  hiddenInformationIds: string[]
  participants: Array<{ id: string; displayName: string }>
  teams: LessonTeamView[]
  responses: LessonResponseView[]
  phases?: PhaseWithDisplayConfig[]
  onApply: (input: InterventionApplyInput) => void
}

/**
 * §6.5's 9 mid-lesson intervention drawer. Every entry is filtered by
 * `canApplyIntervention(role, type)` BEFORE rendering — a type this role
 * cannot perform is never placed in the DOM (authorization-driven
 * omission), which is a different case from Task 6/Task 11's
 * disabledReason pattern (aria-disabled + visible reason for a temporarily
 * blocked-but-authorized action; see LessonStatusHeader.tsx's CTA). There is
 * no disabledReason path in this panel because every visible row IS
 * authorized — the only gate is visibility itself.
 */
export function InterventionPanel({
  open,
  onClose,
  role,
  currentPhaseId,
  phaseHasTimer,
  displayModeOverride,
  informationItems,
  hiddenInformationIds,
  participants,
  teams,
  responses,
  phases,
  onApply,
}: InterventionPanelProps) {
  const [selected, setSelected] = useState<LessonInterventionType | null>(null)
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState<Record<string, string>>({})

  const availableTypes = INTERVENTION_ORDER.filter((type) => canApplyIntervention(role, type))
  const selectedEntry = selected ? INTERVENTION_CATALOG[selected] : null

  const resetForm = () => {
    setSelected(null)
    setReason('')
    setDetail({})
  }

  const handleSubmit = () => {
    if (!selected) return
    onApply({ type: selected, reason, detail })
    resetForm()
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 360, p: 2 }} role="presentation">
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>介入操作</Typography>
        {availableTypes.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            この役割で実行できる操作はありません。
          </Typography>
        ) : selectedEntry && selected ? (
          <Stack spacing={2}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{selectedEntry.label}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{selectedEntry.description}</Typography>
            <TextField
              id="intervention-reason"
              label="理由"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              multiline
              minRows={2}
            />
            {selected === 'EXTEND_TIME' && (
              <ExtendTimeForm
                currentPhaseId={currentPhaseId}
                hasTimer={phaseHasTimer}
                onSubmit={(d) => { onApply({ type: selected, reason, detail: d }); resetForm() }}
              />
            )}
            {selected === 'SWITCH_DISPLAY_MODE' && (
              <DisplayModeForm
                currentOverride={displayModeOverride}
                onSubmit={(d) => { onApply({ type: selected, reason, detail: d }); resetForm() }}
              />
            )}
            {selected === 'HIDE_INFORMATION' && (
              <HideInformationForm
                informationItems={informationItems}
                hiddenInformationIds={hiddenInformationIds}
                onSubmit={(d) => { onApply({ type: selected, reason, detail: d }); resetForm() }}
              />
            )}
            {selected === 'CORRECT_STATE' && (
              <CorrectStateForm
                participants={participants}
                teams={teams.map((team) => ({ teamId: team.id, displayName: team.displayName }))}
                onSubmit={(d) => { onApply({ type: selected, reason, detail: d }); resetForm() }}
              />
            )}
            {selected === 'PROXY_CONFIRM' && (
              <ProxyConfirmForm
                responses={responses}
                participants={participants}
                teams={teams}
                phases={phases}
                onSubmit={(detail, impactScope) => { onApply({ type: selected, reason, detail, impactScope }); resetForm() }}
              />
            )}
            {selected === 'EMERGENCY_STOP' && (
              <Button
                variant="contained"
                color="error"
                sx={{ minHeight: MIN_TOUCH_TARGET }}
                onClick={handleSubmit}
              >
                授業を緊急停止する
              </Button>
            )}
            {selectedEntry.fields.length > 0 && (
              <>
                {selectedEntry.fields.map((field) => (
                  <TextField
                    key={field.key}
                    id={`intervention-detail-${field.key}`}
                    label={field.label}
                    value={detail[field.key] ?? ''}
                    onChange={(e) => setDetail((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                ))}
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={handleSubmit} sx={{ minHeight: MIN_TOUCH_TARGET }}>実行</Button>
                </Stack>
              </>
            )}
            <Button variant="text" onClick={resetForm} sx={{ minHeight: MIN_TOUCH_TARGET }}>戻る</Button>
          </Stack>
        ) : (
          <List>
            {availableTypes.map((type) => {
              const entry = INTERVENTION_CATALOG[type]
              return (
                <ListItemButton
                  key={type}
                  onClick={() => setSelected(type)}
                  sx={{ minHeight: MIN_TOUCH_TARGET }}
                >
                  <ListItemText primary={entry.label} secondary={entry.description} />
                </ListItemButton>
              )
            })}
          </List>
        )}
      </Box>
    </Drawer>
  )
}
