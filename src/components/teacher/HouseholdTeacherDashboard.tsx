import React, { useCallback, useEffect, useState } from 'react'
import type { Database } from 'firebase/database'
import type { Functions } from 'firebase/functions'
import type { LessonRunRole } from '../../lib/lessonRuns/authorization'
import {
  getHouseholdTeacherDashboard,
  type HouseholdTeacherDashboard as HouseholdTeacherDashboardData,
} from '../../lib/homeEconomics/teacherDashboard'
import {
  processHouseholdRoundBatch,
  retryHouseholdRoundBatch,
} from '../../lib/homeEconomics/bulkSettlement'
import { processRound } from '../../lib/homeEconomics/processRound'
import {
  writeHouseholdCheckpoint,
  restoreHouseholdCheckpoint,
} from '../../lib/homeEconomics/checkpoints'
import {
  prepareHouseholdAssignment,
  updateHouseholdAssignment,
  type UpdateHouseholdAssignmentInput,
} from '../../lib/homeEconomics/householdAssignment'
import { showHouseholdComparisonOnDisplay } from '../../lib/homeEconomics/finalComparison'
import { subscribePublicRun } from '../../lib/lessonRuns/liveRepository'
import type { HouseholdClassComparisonPublicView } from '../../lib/lessonRuns/liveTypes'
import { HouseholdTeacherDashboard as HouseholdTeacherDashboardView } from '../homeEconomics/HouseholdTeacherDashboard'
import { HouseholdClassComparisonView } from '../homeEconomics/HouseholdClassComparisonView'

export interface HouseholdTeacherDashboardProps {
  lessonRunId: string
  role: LessonRunRole
  functions: Functions
  database: Database
}

const generateIdempotencyKey = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

export const HouseholdTeacherDashboard: React.FC<HouseholdTeacherDashboardProps> = ({
  lessonRunId,
  role,
  functions,
  database,
}) => {
  const [dashboard, setDashboard] = useState<HouseholdTeacherDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isActionInProgress, setIsActionInProgress] = useState(false)
  const [comparison, setComparison] = useState<HouseholdClassComparisonPublicView | null>(null)
  const [isComparisonVisible, setIsComparisonVisible] = useState(false)

  const isPrimaryTeacher = role === 'PRIMARY'
  // Same PRIMARY-or-ASSISTANT display-switch authority
  // `showHouseholdComparisonOnDisplayCallable` enforces server-side
  // (functions/src/homeEconomics/onCall.ts) — mirrors LessonControlRoom.tsx's
  // own `canEditGuidance` gate for the other display-affecting action.
  const canManageDisplay = role === 'PRIMARY' || role === 'ASSISTANT'

  const loadDashboard = useCallback(async () => {
    try {
      setError(null)
      const data = await getHouseholdTeacherDashboard(functions, { lessonRunId })
      setDashboard(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ダッシュボードの取得に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [functions, lessonRunId])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  // Task 13's class-wide comparison (`HouseholdClassComparisonPublicView`)
  // is never returned by `getHouseholdTeacherDashboard` (that Callable only
  // reports `finalComparisonAvailable: boolean`) — it lives at
  // `lessonRunPublic/{lessonRunId}`'s `householdClassComparison` field,
  // published by `afterReflectionTransition`. Same subscription this data
  // already has on the student side (HouseholdTeamScreen.tsx).
  useEffect(
    () => subscribePublicRun(database, lessonRunId, (publicState) => setComparison(publicState?.householdClassComparison ?? null)),
    [database, lessonRunId],
  )

  const handleProcessRoundBatch = async (expectedRoundIndex: number, forceUnsubmitted: boolean) => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await processHouseholdRoundBatch(functions, {
        lessonRunId,
        expectedRoundIndex,
        forceUnsubmitted,
        idempotencyKey: generateIdempotencyKey('bulk-settle'),
      })
      await loadDashboard()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '一括決算の実行に失敗しました')
      await loadDashboard()
    } finally {
      setIsActionInProgress(false)
    }
  }

  const handleRetryRoundBatch = async (operationId: string) => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await retryHouseholdRoundBatch(functions, {
        lessonRunId,
        operationId,
      })
      await loadDashboard()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '一括決算の再試行に失敗しました')
      await loadDashboard()
    } finally {
      setIsActionInProgress(false)
    }
  }

  const handleProcessIndividualRound = async (householdId: string, forceSettle: boolean) => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await processRound(functions, {
        lessonRunId,
        householdId,
        forceSettle,
      })
      await loadDashboard()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '個別決算の実行に失敗しました')
      await loadDashboard()
    } finally {
      setIsActionInProgress(false)
    }
  }

  const handleSaveManualCheckpoint = async (label: string) => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await writeHouseholdCheckpoint(functions, {
        lessonRunId,
        label,
        idempotencyKey: generateIdempotencyKey('manual-cp'),
      })
      await loadDashboard()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'チェックポイントの保存に失敗しました')
    } finally {
      setIsActionInProgress(false)
    }
  }

  const handleRestoreCheckpoint = async (checkpointId: string, reason: string) => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await restoreHouseholdCheckpoint(functions, {
        lessonRunId,
        checkpointId,
        reason,
        idempotencyKey: generateIdempotencyKey('restore-cp'),
      })
      await loadDashboard()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'チェックポイントの復元に失敗しました')
    } finally {
      setIsActionInProgress(false)
    }
  }

  const handlePrepareAssignment = async () => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await prepareHouseholdAssignment(functions, {
        lessonRunId,
        idempotencyKey: generateIdempotencyKey('prepare-assignment'),
      })
      await loadDashboard()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '割り当ての準備に失敗しました')
    } finally {
      setIsActionInProgress(false)
    }
  }

  const handleUpdateAssignment = async (
    input: Omit<UpdateHouseholdAssignmentInput, 'lessonRunId' | 'idempotencyKey'>,
  ) => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await updateHouseholdAssignment(functions, {
        lessonRunId,
        idempotencyKey: generateIdempotencyKey('update-assignment'),
        ...input,
      })
      await loadDashboard()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '割り当ての更新に失敗しました')
    } finally {
      setIsActionInProgress(false)
    }
  }

  const handleShowOnDisplay = async () => {
    setIsActionInProgress(true)
    setError(null)
    try {
      await showHouseholdComparisonOnDisplay(functions, { lessonRunId })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'クラス比較の教室画面表示に失敗しました')
    } finally {
      setIsActionInProgress(false)
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500 text-sm">
        家庭科ダッシュボードを読み込み中...
      </div>
    )
  }

  if (error && !dashboard) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-800 space-y-3">
        <h3 className="font-bold">ダッシュボードの読み込みエラー</h3>
        <p className="text-sm">{error}</p>
        <button
          type="button"
          onClick={() => {
            setIsLoading(true)
            void loadDashboard()
          }}
          className="px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
        >
          再読み込み
        </button>
      </div>
    )
  }

  if (!dashboard) return null

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-bold ml-2">✕</button>
        </div>
      )}

      <HouseholdTeacherDashboardView
        dashboard={dashboard}
        isPrimaryTeacher={isPrimaryTeacher}
        onRefresh={loadDashboard}
        onProcessRoundBatch={handleProcessRoundBatch}
        onRetryRoundBatch={handleRetryRoundBatch}
        onProcessIndividualRound={handleProcessIndividualRound}
        onSaveManualCheckpoint={handleSaveManualCheckpoint}
        onRestoreCheckpoint={handleRestoreCheckpoint}
        onPrepareAssignment={handlePrepareAssignment}
        onUpdateAssignment={handleUpdateAssignment}
        isActionInProgress={isActionInProgress}
        canManageDisplay={canManageDisplay}
        onViewClassComparison={() => setIsComparisonVisible((prev) => !prev)}
        onShowOnDisplay={() => void handleShowOnDisplay()}
      />

      {isComparisonVisible && comparison && <HouseholdClassComparisonView comparison={comparison} />}
    </div>
  )
}
