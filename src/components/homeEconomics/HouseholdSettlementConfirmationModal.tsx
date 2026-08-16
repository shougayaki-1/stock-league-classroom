import React, { useState } from 'react'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-bold text-gray-900 mb-4">
          第{roundDisplay}ラウンド 一括決算の確認
        </h3>

        <div className="space-y-4 text-sm text-gray-600 mb-6">
          {!hasUnsubmitted ? (
            <p className="text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
              全 {totalHouseholdCount} 世帯（{totalTeamCount} チーム）の意思決定が提出されています。
            </p>
          ) : (
            <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-2">
              <p className="font-semibold text-amber-800">
                未提出の家庭があります（{submittedHouseholdCount} / {totalHouseholdCount} 世帯提出済み、対象 {totalTeamCount} チーム）
              </p>
              <p className="text-xs text-amber-700">
                以下の家庭がまだ意思決定を提出していません：
              </p>
              <ul className="list-disc list-inside text-xs text-amber-900 pl-2">
                {missingHouseholds.map((m) => (
                  <li key={m.householdId}>{m.label}</li>
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
                未提出の家庭を含めて強制決算を行う
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
