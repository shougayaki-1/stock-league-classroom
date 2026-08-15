import React, { useState } from 'react'
import type { HouseholdTeacherRow } from '../../lib/homeEconomics/teacherDashboard'

export interface HouseholdSettlementConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  currentRoundIndex: number | null
  households: HouseholdTeacherRow[]
  onConfirm: (forceUnsubmitted: boolean) => Promise<void>
  isSubmitting: boolean
}

export const HouseholdSettlementConfirmationModal: React.FC<HouseholdSettlementConfirmationModalProps> = ({
  isOpen,
  onClose,
  currentRoundIndex,
  households,
  onConfirm,
  isSubmitting,
}) => {
  const [forceUnsubmitted, setForceUnsubmitted] = useState(false)

  if (!isOpen) return null

  const roundDisplay = currentRoundIndex !== null ? currentRoundIndex + 1 : '?'
  const unsubmittedHouseholds = households.filter((h) => !h.submittedForRoundIndex)
  const hasUnsubmitted = unsubmittedHouseholds.length > 0
  const canExecute = !hasUnsubmitted || forceUnsubmitted

  const handleExecute = async () => {
    if (!canExecute || isSubmitting) return
    await onConfirm(hasUnsubmitted ? forceUnsubmitted : false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-bold text-gray-900 mb-4">
          第{roundDisplay}ラウンド 一括決算の確認
        </h3>

        <div className="space-y-4 text-sm text-gray-600 mb-6">
          {!hasUnsubmitted ? (
            <p className="text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
              全 {households.length} チームの意思決定が提出されています。
            </p>
          ) : (
            <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-2">
              <p className="font-semibold text-amber-800">
                未提出のチームがあります（{households.length - unsubmittedHouseholds.length} / {households.length} チーム提出済み）
              </p>
              <p className="text-xs text-amber-700">
                以下のチームがまだ意思決定を提出していません：
              </p>
              <ul className="list-disc list-inside text-xs text-amber-900 pl-2">
                {unsubmittedHouseholds.map((h) => (
                  <li key={h.householdId}>{h.teamDisplayName}</li>
                ))}
              </ul>
              <label className="flex items-center gap-2 pt-2 text-xs font-medium text-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceUnsubmitted}
                  onChange={(e) => setForceUnsubmitted(e.target.checked)}
                  disabled={isSubmitting}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                未提出チームを含めて強制決算を行う
              </label>
            </div>
          )}

          <p className="text-xs text-gray-500">
            決算を実行すると、自動的に「決算前チェックポイント」が作成され、すべての家庭の収支計算とイベント判定が行われます。
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleExecute}
            disabled={!canExecute || isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition shadow-sm"
          >
            {isSubmitting ? '処理中...' : hasUnsubmitted ? '強制決算を実行' : '決算を実行'}
          </button>
        </div>
      </div>
    </div>
  )
}
