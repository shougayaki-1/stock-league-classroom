import React, { useState } from 'react'
import { Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material'
import type { HouseholdTeacherTeamRow } from '../../lib/homeEconomics/teacherDashboard'

export interface HouseholdSettlementConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  currentRoundIndex: number | null
  teams: HouseholdTeacherTeamRow[]
  onConfirm: (forceUnsubmitted: boolean) => Promise<void>
  isSubmitting: boolean
}

interface MissingHouseholdLabel {
  householdId: string
  label: string
}

export const HouseholdSettlementConfirmationModal: React.FC<HouseholdSettlementConfirmationModalProps> = ({
  isOpen,
  onClose,
  currentRoundIndex,
  teams,
  onConfirm,
  isSubmitting,
}) => {
  const [forceUnsubmitted, setForceUnsubmitted] = useState(false)

  if (!isOpen) return null

  const roundDisplay = currentRoundIndex !== null ? currentRoundIndex + 1 : '?'

  const allHouseholds = teams.flatMap((t) => t.households)
  const totalHouseholdCount = allHouseholds.length
  const totalTeamCount = teams.length

  // Missing is reported per-HOUSEHOLD (not per-team) since a
  // MULTI_PERSON_PER_TEAM team can have some households submitted and
  // others not — an exact "チームA — 田中家" style label distinguishes
  // which household within a team is missing.
  const missingHouseholds: MissingHouseholdLabel[] = []
  for (const team of teams) {
    const isMultiHousehold = team.totalHouseholds > 1
    for (const household of team.households) {
      if (household.submittedForRoundIndex) continue
      missingHouseholds.push({
        householdId: household.householdId,
        label: isMultiHousehold
          ? `${team.teamDisplayName} — ${household.lifeStage}`
          : team.teamDisplayName,
      })
    }
  }

  const hasUnsubmitted = missingHouseholds.length > 0
  const canExecute = !hasUnsubmitted || forceUnsubmitted
  const submittedHouseholdCount = totalHouseholdCount - missingHouseholds.length

  const handleExecute = async () => {
    if (!canExecute || isSubmitting) return
    await onConfirm(hasUnsubmitted ? forceUnsubmitted : false)
  }

  return (
    <Box
      sx={{
        position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.modal, display: 'flex',
        alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.5)', p: 2,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 512, borderRadius: '12px', bgcolor: 'background.paper', p: 3, boxShadow: 24 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
          第{roundDisplay}ラウンド 一括決算の確認
        </Typography>

        <Stack spacing={2} sx={{ fontSize: '0.875rem', color: 'text.secondary', mb: 3 }}>
          {!hasUnsubmitted ? (
            <Typography sx={{ color: 'success.dark', bgcolor: 'success.light', p: 1.5, borderRadius: 2, border: 1, borderColor: 'success.main' }}>
              全 {totalHouseholdCount} 世帯（{totalTeamCount} チーム）の意思決定が提出されています。
            </Typography>
          ) : (
            <Stack spacing={1} sx={{ bgcolor: 'warning.light', p: 1.5, borderRadius: 2, border: 1, borderColor: 'warning.main' }}>
              <Typography sx={{ fontWeight: 600, color: 'warning.dark' }}>
                未提出の家庭があります（{submittedHouseholdCount} / {totalHouseholdCount} 世帯提出済み、対象 {totalTeamCount} チーム）
              </Typography>
              <Typography variant="caption" sx={{ color: 'warning.dark' }}>
                以下の家庭がまだ意思決定を提出していません：
              </Typography>
              <Box component="ul" sx={{ listStyle: 'disc', pl: 3, m: 0, fontSize: '0.75rem', color: 'warning.dark' }}>
                {missingHouseholds.map((m) => (
                  <li key={m.householdId}>{m.label}</li>
                ))}
              </Box>
              <FormControlLabel
                sx={{ pt: 1, ml: 0 }}
                control={
                  <Checkbox
                    size="small"
                    checked={forceUnsubmitted}
                    onChange={(e) => setForceUnsubmitted(e.target.checked)}
                    disabled={isSubmitting}
                  />
                }
                label={<Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>未提出の家庭を含めて強制決算を行う</Typography>}
              />
            </Stack>
          )}

          <Typography variant="caption" color="text.secondary">
            決算を実行すると、自動的に「決算前チェックポイント」が作成され、すべての家庭の収支計算とイベント判定が行われます。
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
          <Button variant="text" color="inherit" onClick={onClose} disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button
            variant="contained"
            color={hasUnsubmitted ? 'warning' : 'primary'}
            onClick={() => { void handleExecute() }}
            disabled={!canExecute || isSubmitting}
          >
            {isSubmitting ? '処理中...' : hasUnsubmitted ? '強制決算を実行' : '決算を実行'}
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}
