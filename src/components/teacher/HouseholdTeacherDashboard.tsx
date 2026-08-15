import React, { useCallback, useEffect, useState } from 'react'
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
import { HouseholdTeacherDashboard as HouseholdTeacherDashboardView } from '../homeEconomics/HouseholdTeacherDashboard'

export interface HouseholdTeacherDashboardProps {
  lessonRunId: string
  role: LessonRunRole
  functions: Functions
}

const generateIdempotencyKey = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

export const HouseholdTeacherDashboard: React.FC<HouseholdTeacherDashboardProps> = ({
  lessonRunId,
  role,
  functions,
}) => {
  const [dashboard, setDashboard] = useState<HouseholdTeacherDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isActionInProgress, setIsActionInProgress] = useState(false)

  const isPrimaryTeacher = role === 'PRIMARY'

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
        isActionInProgress={isActionInProgress}
      />
    </div>
  )
}
