import React, { useState } from 'react'
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

const severityClass = (severity: 'ACTION_REQUIRED' | 'WARNING' | 'INFO') => {
  switch (severity) {
    case 'ACTION_REQUIRED':
      return 'bg-red-50 text-red-700 border-red-200'
    case 'WARNING':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    case 'INFO':
      return 'bg-blue-50 text-blue-800 border-blue-200'
  }
}

const HouseholdWarnings: React.FC<{ warnings: HouseholdTeacherRow['warnings'] }> = ({ warnings }) => {
  if (warnings.length === 0) {
    return <span className="text-xs text-gray-400">なし</span>
  }
  return (
    <div className="space-y-1">
      {warnings.map((w, idx) => (
        <div key={idx} className={`text-xs px-2 py-0.5 rounded border ${severityClass(w.severity)}`}>
          {w.message}
        </div>
      ))}
    </div>
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
    <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center py-2 text-sm text-gray-600">
      <div>
        {/* Important I3 fix: `profileLabel` (lifeStage・family) instead of
            bare `lifeStage` — a MULTI team's several household rows are
            otherwise only distinguishable by the opaque runtime
            householdId, since MULTI_PERSON_PER_TEAM can repeat the same
            lifeStage across its full profile set. */}
        <div className="font-medium text-gray-900">{row.profileLabel}</div>
        <div className="text-xs text-gray-400">第{row.roundIndex + 1}R</div>
      </div>
      <div>
        {row.submittedForRoundIndex ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            提出済
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
            未提出
          </span>
        )}
      </div>
      <div>
        <span className={`font-medium ${isNegative ? 'text-red-600 font-bold' : 'text-gray-900'}`}>
          {row.cashYen.toLocaleString()} 円
        </span>
      </div>
      <div className="text-gray-800">{row.totalAssetsYen.toLocaleString()} 円</div>
      <div>
        <HouseholdWarnings warnings={row.warnings} />
      </div>
      {isPrimaryTeacher && showIndividualSettlement && (
        <div className="text-right">
          <button
            type="button"
            onClick={() => onSelectIndividual(row)}
            disabled={isBusy || isLeaseActive || !row.submittedForRoundIndex}
            title={!row.submittedForRoundIndex ? '意思決定が未提出のため個別決算できません。未提出のまま決算するには一括決算の強制実行を使用してください。' : undefined}
            className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded transition border border-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            個別決算
          </button>
        </div>
      )}
    </div>
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-semibold text-gray-900">{team.teamDisplayName}</div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              team.allSubmitted ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {team.submittedCount} / {team.totalHouseholds} 提出済み
          </span>
        </div>
      </div>

      {team.warnings.length > 0 && (
        <div className="mt-2">
          <HouseholdWarnings warnings={team.warnings} />
        </div>
      )}

      {!isMulti ? (
        team.households[0] && (
          <div className="mt-2 border-t border-gray-100 pt-2">
            <HouseholdSummaryRow
              row={team.households[0]}
              isPrimaryTeacher={isPrimaryTeacher}
              isBusy={isBusy}
              isLeaseActive={isLeaseActive}
              showIndividualSettlement={showIndividualSettlement}
              onSelectIndividual={onSelectIndividual}
            />
          </div>
        )
      ) : (
        <div className="mt-2 border-t border-gray-100 divide-y divide-gray-100">
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
        </div>
      )}
    </div>
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
    <div className="space-y-6">
      {/* Header card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">
                家庭経済・ライフプラン管理ダッシュボード
              </h2>
              {dashboard.restoreGeneration > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                  復元 第{dashboard.restoreGeneration}世代
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              全チームの意思決定状況、資産・保険・負債の現況および一括決算を管理します。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isBusy}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              更新
            </button>
            <button
              type="button"
              onClick={() => setIsCheckpointModalOpen(true)}
              disabled={checkpointDisabled}
              className="px-3.5 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              チェックポイント・復元
            </button>
            {isPrimaryTeacher && (
              <button
                type="button"
                onClick={() => setIsSettlementModalOpen(true)}
                disabled={bulkSettlementDisabled}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition shadow-sm"
              >
                一括決算
              </button>
            )}
            {/* Task 13: only once the class-wide comparison exists
                (dashboard.finalComparisonAvailable, Task 10/12) AND this
                teacher has display-switch authority (canManageDisplay,
                PRIMARY/ASSISTANT — matches showHouseholdComparisonOnDisplayCallable's
                server-side gate). */}
            {dashboard.finalComparisonAvailable && canManageDisplay && onViewClassComparison && (
              <button
                type="button"
                onClick={onViewClassComparison}
                disabled={isBusy}
                className="px-3.5 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                クラス比較を見る
              </button>
            )}
            {dashboard.finalComparisonAvailable && canManageDisplay && onShowOnDisplay && (
              <button
                type="button"
                onClick={onShowOnDisplay}
                disabled={isBusy}
                className="px-3.5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                教室画面に表示
              </button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100 text-sm">
          <div className="space-y-1">
            <span className="text-xs text-gray-500">進行ラウンド</span>
            <div className="font-bold text-gray-900">
              {dashboard.householdsAligned && dashboard.currentRoundIndex !== null ? (
                `第${dashboard.currentRoundIndex + 1}ラウンド`
              ) : (
                <span className="text-amber-600 font-semibold">ラウンド不一致</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-gray-500">意思決定の提出状況</span>
            <div className="font-bold text-gray-900">
              {submittedCount} / {totalCount} 提出済み
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-gray-500">登録チーム数</span>
            <div className="font-bold text-gray-900">{teams.length} チーム</div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-gray-500">最終更新</span>
            <div className="font-medium text-gray-600">
              {new Date(dashboard.updatedAtServerMillis).toLocaleTimeString('ja-JP')}
            </div>
          </div>
        </div>
      </div>

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
        <div
          className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 ${
            dashboard.activeBulkOperation.status === 'FAILED'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-indigo-50 border-indigo-200 text-indigo-900'
          }`}
        >
          <div className="space-y-1 text-sm">
            <div className="font-bold">
              {dashboard.activeBulkOperation.status === 'FAILED'
                ? `前回の第${dashboard.activeBulkOperation.expectedRoundIndex + 1}ラウンド一括決算でエラーが発生しました`
                : `第${dashboard.activeBulkOperation.expectedRoundIndex + 1}ラウンドの一括決算を実行中（試行回数: ${dashboard.activeBulkOperation.attempt}）`}
            </div>
            <div className="text-xs opacity-90">
              {dashboard.activeBulkOperation.status === 'FAILED'
                ? '一部またはすべての家庭の決算に失敗しました。再試行を実行できます。'
                : '処理が完了するまでしばらくお待ちください。'}
            </div>
          </div>

          {isPrimaryTeacher && dashboard.activeBulkOperation.retryable && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={isBusy}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg shadow-sm"
            >
              {isBusy ? '再試行中...' : '一括決算を再試行'}
            </button>
          )}
        </div>
      )}

      {/* Team cards */}
      <div className="space-y-3">
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
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              {selectedIndividualHousehold.teamDisplayName} の個別決算
            </h3>
            <p className="text-sm text-gray-600">
              {selectedIndividualHousehold.submittedForRoundIndex
                ? `第${selectedIndividualHousehold.roundIndex + 1}ラウンドの決算を実行します。`
                : (
                  <span className="block font-semibold text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                    ⚠️ このチームは意思決定を未提出のため個別決算できません。未提出のまま決算するには一括決算の強制実行を使用してください。
                  </span>
                )}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedIndividualHousehold(null)}
                disabled={isBusy}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleIndividualProcess(selectedIndividualHousehold)}
                disabled={isBusy || !selectedIndividualHousehold.submittedForRoundIndex}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                {isBusy ? '処理中...' : '個別決算を実行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
