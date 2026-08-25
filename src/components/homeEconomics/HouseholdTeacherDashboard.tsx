import React, { useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type {
  HouseholdTeacherDashboard as HouseholdTeacherDashboardType,
  HouseholdTeacherRow,
  HouseholdTeacherTeamRow,
} from '../../lib/homeEconomics/teacherDashboard'
import type {
  HouseholdAssignmentView,
  UpdateHouseholdAssignmentInput,
} from '../../lib/homeEconomics/householdAssignment'
import { HouseholdSettlementConfirmationModal } from './HouseholdSettlementConfirmationModal'
import { HouseholdCheckpointModal } from './HouseholdCheckpointModal'
import { HouseholdAssignmentPanel } from './HouseholdAssignmentPanel'
import { formatHouseholdProfileLabel } from '../../lib/presentation/householdLabels'

export interface HouseholdTeacherDashboardProps {
  dashboard: HouseholdTeacherDashboardType
  isPrimaryTeacher: boolean
  onRefresh: () => Promise<void>
  onProcessRoundBatch: (expectedRoundIndex: number, forceUnsubmitted: boolean) => Promise<void>
  onRetryRoundBatch: (operationId: string) => Promise<void>
  onProcessIndividualRound: (householdId: string, forceSettle: boolean) => Promise<void>
  onSaveManualCheckpoint: (label: string) => Promise<void>
  onRestoreCheckpoint: (checkpointId: string, reason: string) => Promise<void>
  onPrepareAssignment?: () => Promise<void>
  onUpdateAssignment?: (input: Omit<UpdateHouseholdAssignmentInput, 'lessonRunId' | 'idempotencyKey'>) => Promise<void>
  isActionInProgress?: boolean
  /**
   * Task 13: PRIMARY-or-ASSISTANT display-switch authority — the same gate
   * `showHouseholdComparisonOnDisplayCallable`/`issueDisplaySessionTokenCallable`
   * enforce server-side (functions/src/lessonRuns/projections/onCall.ts).
   * Distinct from `isPrimaryTeacher` above (PRIMARY-only, used for the
   * settlement actions) — an ASSISTANT teacher may switch the projector but
   * may not run a bulk settlement.
   */
  canManageDisplay?: boolean
  /** "クラス比較を見る" — renders `HouseholdClassComparisonView` for the teacher's own screen. Absent/undefined hides the action entirely. */
  onViewClassComparison?: () => void
  /** "教室画面に表示" — calls `showHouseholdComparisonOnDisplayCallable` to switch the shared classroom projector. Absent/undefined hides the action entirely. */
  onShowOnDisplay?: () => void
}

const SEVERITY_TONE: Record<'ACTION_REQUIRED' | 'WARNING' | 'INFO', { bg: string; color: string; border: string }> = {
  ACTION_REQUIRED: { bg: 'error.light', color: 'error.dark', border: 'error.main' },
  WARNING: { bg: 'warning.light', color: 'warning.dark', border: 'warning.main' },
  INFO: { bg: 'primary.light', color: 'primary.dark', border: 'primary.main' },
}

const HouseholdWarnings: React.FC<{ warnings: HouseholdTeacherRow['warnings'] }> = ({ warnings }) => {
  if (warnings.length === 0) {
    return <Typography variant="caption" color="text.disabled">なし</Typography>
  }
  return (
    <Stack spacing={0.5}>
      {warnings.map((w, idx) => {
        const tone = SEVERITY_TONE[w.severity]
        return (
          <Typography key={idx} variant="caption" sx={{ px: 1, py: 0.25, borderRadius: 1, border: 1, bgcolor: tone.bg, color: tone.color, borderColor: tone.border }}>
            {w.message}
          </Typography>
        )
      })}
    </Stack>
  )
}

const HouseholdSummaryRow: React.FC<{
  row: HouseholdTeacherRow
  isPrimaryTeacher: boolean
  isBusy: boolean
  isLeaseActive: boolean
  showIndividualSettlement: boolean
  onSelectIndividual: (row: HouseholdTeacherRow) => void
}> = ({ row, isPrimaryTeacher, isBusy, isLeaseActive, showIndividualSettlement, onSelectIndividual }) => {
  const isNegative = row.cashYen < 0
  return (
    <Box
      sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(6, 1fr)' },
        gap: 1.5, alignItems: 'center', py: 1, fontSize: '0.875rem', color: 'text.secondary',
      }}
    >
      <Box>
        {/* Important I3 fix + Project C: a translated lifeStage・family
            label, built client-side from `row.profileSummary` (semantic
            data, not a server-composed display string) — instead of
            bare `lifeStage` — a MULTI team's several household rows are
            otherwise only distinguishable by the opaque runtime
            householdId, since MULTI_PERSON_PER_TEAM can repeat the same
            lifeStage across its full profile set. */}
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {formatHouseholdProfileLabel(row.profileSummary?.lifeStage, row.profileSummary?.family)}
        </Typography>
        <Typography variant="caption" color="text.disabled">第{row.roundIndex + 1}R</Typography>
      </Box>
      <Box>
        {row.submittedForRoundIndex ? (
          <Box component="span" sx={{ display: 'inline-flex', px: 1, py: 0.25, borderRadius: 1, fontSize: '0.75rem', fontWeight: 600, bgcolor: 'success.light', color: 'success.dark' }}>
            提出済
          </Box>
        ) : (
          <Box component="span" sx={{ display: 'inline-flex', px: 1, py: 0.25, borderRadius: 1, fontSize: '0.75rem', fontWeight: 600, bgcolor: 'grey.100', color: 'text.secondary' }}>
            未提出
          </Box>
        )}
      </Box>
      <Box>
        <Typography component="span" sx={{ fontWeight: isNegative ? 700 : 600, color: isNegative ? 'error.main' : 'text.primary' }}>
          {row.cashYen.toLocaleString()} 円
        </Typography>
      </Box>
      <Typography sx={{ color: 'text.primary' }}>{row.totalAssetsYen.toLocaleString()} 円</Typography>
      <Box>
        <HouseholdWarnings warnings={row.warnings} />
      </Box>
      {isPrimaryTeacher && showIndividualSettlement && (
        <Box sx={{ textAlign: 'right' }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onSelectIndividual(row)}
            disabled={isBusy || isLeaseActive || !row.submittedForRoundIndex}
            title={!row.submittedForRoundIndex ? '意思決定が未提出のため個別決算できません。未提出のまま決算するには一括決算の強制実行を使用してください。' : undefined}
          >
            個別決算
          </Button>
        </Box>
      )}
    </Box>
  )
}

const TeamCard: React.FC<{
  team: HouseholdTeacherTeamRow
  isPrimaryTeacher: boolean
  isBusy: boolean
  isLeaseActive: boolean
  showIndividualSettlement: boolean
  onSelectIndividual: (row: HouseholdTeacherRow) => void
}> = ({ team, isPrimaryTeacher, isBusy, isLeaseActive, showIndividualSettlement, onSelectIndividual }) => {
  const isMulti = team.totalHouseholds > 1

  return (
    <Box sx={{ bgcolor: 'background.paper', borderRadius: '12px', boxShadow: 1, border: 1, borderColor: 'grey.200', p: 2 }}>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontWeight: 600 }}>{team.teamDisplayName}</Typography>
        <Box
          component="span"
          sx={{
            display: 'inline-flex', px: 1, py: 0.25, borderRadius: 1, fontSize: '0.75rem', fontWeight: 600,
            bgcolor: team.allSubmitted ? 'success.light' : 'warning.light',
            color: team.allSubmitted ? 'success.dark' : 'warning.dark',
          }}
        >
          {team.submittedCount} / {team.totalHouseholds} 提出済み
        </Box>
      </Stack>

      {team.warnings.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <HouseholdWarnings warnings={team.warnings} />
        </Box>
      )}

      {!isMulti ? (
        team.households[0] && (
          <Box sx={{ mt: 1, borderTop: 1, borderColor: 'grey.100', pt: 1 }}>
            <HouseholdSummaryRow
              row={team.households[0]}
              isPrimaryTeacher={isPrimaryTeacher}
              isBusy={isBusy}
              isLeaseActive={isLeaseActive}
              showIndividualSettlement={showIndividualSettlement}
              onSelectIndividual={onSelectIndividual}
            />
          </Box>
        )
      ) : (
        <Box sx={{ mt: 1, borderTop: 1, borderColor: 'grey.100', '& > *:not(:last-child)': { borderBottom: 1, borderColor: 'grey.100' } }}>
          {team.households.map((h) => (
            <HouseholdSummaryRow
              key={h.householdId}
              row={h}
              isPrimaryTeacher={isPrimaryTeacher}
              isBusy={isBusy}
              isLeaseActive={isLeaseActive}
              showIndividualSettlement={showIndividualSettlement}
              onSelectIndividual={onSelectIndividual}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

export const HouseholdTeacherDashboard: React.FC<HouseholdTeacherDashboardProps> = ({
  dashboard,
  isPrimaryTeacher,
  onRefresh,
  onProcessRoundBatch,
  onRetryRoundBatch,
  onProcessIndividualRound,
  onSaveManualCheckpoint,
  onRestoreCheckpoint,
  onPrepareAssignment,
  onUpdateAssignment,
  isActionInProgress = false,
  canManageDisplay = false,
  onViewClassComparison,
  onShowOnDisplay,
}) => {
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false)
  const [isCheckpointModalOpen, setIsCheckpointModalOpen] = useState(false)
  const [isLocalSubmitting, setIsLocalSubmitting] = useState(false)
  const [selectedIndividualHousehold, setSelectedIndividualHousehold] = useState<HouseholdTeacherRow | null>(null)

  const isBusy = isActionInProgress || isLocalSubmitting
  const isLeaseActive = dashboard.activeBulkOperation?.leaseActive ?? false
  const isSettling = dashboard.roundStatus === 'SETTLING'
  const isCommon = dashboard.courseFormat === 'COMMON_CONDITIONS'
  const showIndividualSettlement = isCommon

  const teams = dashboard.teams ?? []
  const checkpoints = dashboard.checkpoints ?? []
  const allHouseholds = teams.flatMap((t) => t.households)
  const submittedCount = allHouseholds.filter((h) => h.submittedForRoundIndex).length
  const totalCount = allHouseholds.length

  // Advanced formats block manual checkpoint creation and starting a NEW
  // bulk settlement while SETTLING (Task 5/6/7's server-side SETTLING
  // guards). Common has no roundStatus and stays governed by isLeaseActive
  // alone, as before.
  const checkpointDisabled = isBusy || isLeaseActive || (!isCommon && isSettling)
  const bulkSettlementDisabled = isBusy || dashboard.currentRoundIndex === null || isLeaseActive || (!isCommon && isSettling)

  const handleBatchConfirm = async (forceUnsubmitted: boolean) => {
    if (dashboard.currentRoundIndex === null) return
    setIsLocalSubmitting(true)
    try {
      await onProcessRoundBatch(dashboard.currentRoundIndex, forceUnsubmitted)
      setIsSettlementModalOpen(false)
    } finally {
      setIsLocalSubmitting(false)
    }
  }

  const handleRetry = async () => {
    if (!dashboard.activeBulkOperation?.operationId) return
    setIsLocalSubmitting(true)
    try {
      await onRetryRoundBatch(dashboard.activeBulkOperation.operationId)
    } finally {
      setIsLocalSubmitting(false)
    }
  }

  const handleSaveManualCheckpoint = async (label: string) => {
    setIsLocalSubmitting(true)
    try {
      await onSaveManualCheckpoint(label)
    } finally {
      setIsLocalSubmitting(false)
    }
  }

  const handleRestoreCheckpoint = async (checkpointId: string, reason: string) => {
    setIsLocalSubmitting(true)
    try {
      await onRestoreCheckpoint(checkpointId, reason)
      setIsCheckpointModalOpen(false)
    } finally {
      setIsLocalSubmitting(false)
    }
  }

  const handleIndividualProcess = async (household: HouseholdTeacherRow) => {
    if (!household.submittedForRoundIndex) return
    setIsLocalSubmitting(true)
    try {
      await onProcessIndividualRound(household.householdId, false)
      setSelectedIndividualHousehold(null)
    } finally {
      setIsLocalSubmitting(false)
    }
  }

  return (
    <Stack spacing={3}>
      {/* Header card */}
      <Box sx={{ bgcolor: 'background.paper', borderRadius: '12px', boxShadow: 1, border: 1, borderColor: 'grey.200', p: 3 }}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                家庭経済・ライフプラン管理ダッシュボード
              </Typography>
              {dashboard.restoreGeneration > 0 && (
                <Box component="span" sx={{ px: 1.25, py: 0.25, borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, bgcolor: '#f3e8fd', color: '#6a1b9a' }}>
                  復元済み
                </Box>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              全チームの意思決定状況、資産・保険・負債の現況および一括決算を管理します。
            </Typography>
          </Box>

          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="text" color="inherit" onClick={() => { void onRefresh() }} disabled={isBusy}>
              更新
            </Button>
            <Button variant="outlined" onClick={() => setIsCheckpointModalOpen(true)} disabled={checkpointDisabled}>
              チェックポイント・復元
            </Button>
            {isPrimaryTeacher && (
              <Button variant="contained" onClick={() => setIsSettlementModalOpen(true)} disabled={bulkSettlementDisabled}>
                一括決算
              </Button>
            )}
            {/* Task 13: only once the class-wide comparison exists
                (dashboard.finalComparisonAvailable, Task 10/12) AND this
                teacher has display-switch authority (canManageDisplay,
                PRIMARY/ASSISTANT — matches showHouseholdComparisonOnDisplayCallable's
                server-side gate). */}
            {dashboard.finalComparisonAvailable && canManageDisplay && onViewClassComparison && (
              <Button variant="outlined" onClick={onViewClassComparison} disabled={isBusy}>
                クラス比較を見る
              </Button>
            )}
            {dashboard.finalComparisonAvailable && canManageDisplay && onShowOnDisplay && (
              <Button variant="contained" onClick={onShowOnDisplay} disabled={isBusy}>
                教室画面に表示
              </Button>
            )}
          </Stack>
        </Stack>

        {/* Stats bar */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mt: 3, pt: 3, borderTop: 1, borderColor: 'grey.100' }}>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">進行ラウンド</Typography>
            <Typography sx={{ fontWeight: 700 }}>
              {dashboard.householdsAligned && dashboard.currentRoundIndex !== null ? (
                `第${dashboard.currentRoundIndex + 1}ラウンド`
              ) : (
                <Box component="span" sx={{ color: 'warning.dark', fontWeight: 700 }}>ラウンド不一致</Box>
              )}
            </Typography>
          </Stack>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">意思決定の提出状況</Typography>
            <Typography sx={{ fontWeight: 700 }}>
              {submittedCount} / {totalCount} 提出済み
            </Typography>
          </Stack>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">登録チーム数</Typography>
            <Typography sx={{ fontWeight: 700 }}>{teams.length} チーム</Typography>
          </Stack>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">最終更新</Typography>
            <Typography sx={{ fontWeight: 600, color: 'text.secondary' }}>
              {new Date(dashboard.updatedAtServerMillis).toLocaleTimeString('ja-JP')}
            </Typography>
          </Stack>
        </Box>
      </Box>

      {/* Assignment panel (advanced formats only) */}
      {!isCommon && dashboard.assignment && onPrepareAssignment && onUpdateAssignment && (
        <HouseholdAssignmentPanel
          assignment={dashboard.assignment as HouseholdAssignmentView}
          isPrimaryTeacher={isPrimaryTeacher}
          isBusy={isBusy}
          onPrepare={onPrepareAssignment}
          onUpdate={onUpdateAssignment}
        />
      )}

      {/* Active bulk operation banner */}
      {dashboard.activeBulkOperation && (
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{
            p: 2, borderRadius: '12px', border: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
            bgcolor: dashboard.activeBulkOperation.status === 'FAILED' ? 'error.light' : 'primary.light',
            borderColor: dashboard.activeBulkOperation.status === 'FAILED' ? 'error.main' : 'primary.main',
            color: dashboard.activeBulkOperation.status === 'FAILED' ? 'error.dark' : 'primary.dark',
          }}
        >
          <Stack spacing={0.5} sx={{ fontSize: '0.875rem' }}>
            <Typography sx={{ fontWeight: 700, color: 'inherit' }}>
              {dashboard.activeBulkOperation.status === 'FAILED'
                ? `前回の第${dashboard.activeBulkOperation.expectedRoundIndex + 1}ラウンド一括決算でエラーが発生しました`
                : `第${dashboard.activeBulkOperation.expectedRoundIndex + 1}ラウンドの一括決算を実行中（試行回数: ${dashboard.activeBulkOperation.attempt}）`}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.9, color: 'inherit' }}>
              {dashboard.activeBulkOperation.status === 'FAILED'
                ? '一部またはすべての家庭の決算に失敗しました。再試行を実行できます。'
                : '処理が完了するまでしばらくお待ちください。'}
            </Typography>
          </Stack>

          {isPrimaryTeacher && dashboard.activeBulkOperation.retryable && (
            <Button
              size="small"
              variant="contained"
              color="error"
              onClick={() => { void handleRetry() }}
              disabled={isBusy}
            >
              {isBusy ? '再試行中...' : '一括決算を再試行'}
            </Button>
          )}
        </Stack>
      )}

      {/* Team cards */}
      <Stack spacing={1.5}>
        {teams.map((team) => (
          <TeamCard
            key={team.teamId}
            team={team}
            isPrimaryTeacher={isPrimaryTeacher}
            isBusy={isBusy}
            isLeaseActive={isLeaseActive}
            showIndividualSettlement={showIndividualSettlement}
            onSelectIndividual={setSelectedIndividualHousehold}
          />
        ))}
      </Stack>

      {/* Modals */}
      <HouseholdSettlementConfirmationModal
        isOpen={isSettlementModalOpen}
        onClose={() => setIsSettlementModalOpen(false)}
        currentRoundIndex={dashboard.currentRoundIndex}
        teams={teams}
        onConfirm={handleBatchConfirm}
        isSubmitting={isLocalSubmitting}
      />

      <HouseholdCheckpointModal
        isOpen={isCheckpointModalOpen}
        onClose={() => setIsCheckpointModalOpen(false)}
        checkpoints={checkpoints}
        courseFormat={dashboard.courseFormat}
        currentAssignmentRevision={dashboard.assignment?.assignmentRevision ?? null}
        onSaveManualCheckpoint={handleSaveManualCheckpoint}
        onRestoreCheckpoint={handleRestoreCheckpoint}
        isSubmitting={isLocalSubmitting}
      />

      {/* Individual Settlement Confirm Modal (COMMON_CONDITIONS only — advanced
          formats never offer individual settlement, matching Task 6's
          server-side rejection of per-household settlement for advanced
          formats). */}
      {showIndividualSettlement && selectedIndividualHousehold && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.5)', p: 2 }}>
          <Stack spacing={2} sx={{ width: '100%', maxWidth: 448, borderRadius: '12px', bgcolor: 'background.paper', p: 3, boxShadow: 24 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {selectedIndividualHousehold.teamDisplayName} の個別決算
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedIndividualHousehold.submittedForRoundIndex
                ? `第${selectedIndividualHousehold.roundIndex + 1}ラウンドの決算を実行します。`
                : (
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 600, color: 'warning.dark', bgcolor: 'warning.light', p: 1, borderRadius: 1, border: 1, borderColor: 'warning.main' }}>
                    <WarningAmberIcon fontSize="small" />
                    このチームは意思決定を未提出のため個別決算できません。未提出のまま決算するには一括決算の強制実行を使用してください。
                  </Box>
                )}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end', pt: 1 }}>
              <Button variant="text" color="inherit" onClick={() => setSelectedIndividualHousehold(null)} disabled={isBusy}>
                キャンセル
              </Button>
              <Button
                variant="contained"
                onClick={() => { void handleIndividualProcess(selectedIndividualHousehold) }}
                disabled={isBusy || !selectedIndividualHousehold.submittedForRoundIndex}
              >
                {isBusy ? '処理中...' : '個別決算を実行'}
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}
    </Stack>
  )
}
