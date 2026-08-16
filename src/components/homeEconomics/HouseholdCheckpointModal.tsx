import React, { useState } from 'react'
import type { HouseholdCheckpointManifest } from '../../lib/homeEconomics/teacherDashboard'
import type { CourseFormat } from '../../lib/homeEconomics/householdAssignment'

export interface HouseholdCheckpointModalProps {
  isOpen: boolean
  onClose: () => void
  checkpoints: HouseholdCheckpointManifest[]
  /** Used only to label the checkpoint list; not required for the incompatible-restore guard (that uses each checkpoint's own `schemaVersion`). */
  courseFormat?: CourseFormat
  /**
   * The lesson's CURRENT `HouseholdAssignmentConfig.assignmentRevision`
   * (null for Common, which has no per-team assignment). Compared against
   * each v3 checkpoint's own `assignmentRevision` (when present — see
   * `HouseholdCheckpointManifest.assignmentRevision`'s doc comment for why
   * this is not populated by any real server path yet) to disable restoring
   * a checkpoint taken under a since-changed assignment. The server's
   * `restoreHouseholdCheckpointV3` already rejects this case outright; this
   * is a UX improvement so the teacher doesn't attempt a restore the server
   * will reject anyway, not a new security boundary.
   */
  currentAssignmentRevision?: number | null
  onSaveManualCheckpoint: (label: string) => Promise<void>
  onRestoreCheckpoint: (checkpointId: string, reason: string) => Promise<void>
  isSubmitting: boolean
}

const isIncompatibleV3Checkpoint = (
  checkpoint: HouseholdCheckpointManifest,
  currentAssignmentRevision: number | null | undefined,
): boolean => {
  if (checkpoint.schemaVersion !== 3) return false
  if (checkpoint.assignmentRevision === undefined) return false
  if (currentAssignmentRevision === null || currentAssignmentRevision === undefined) return false
  return checkpoint.assignmentRevision !== currentAssignmentRevision
}

export const HouseholdCheckpointModal: React.FC<HouseholdCheckpointModalProps> = ({
  isOpen,
  onClose,
  checkpoints,
  currentAssignmentRevision = null,
  onSaveManualCheckpoint,
  onRestoreCheckpoint,
  isSubmitting,
}) => {
  const [newLabel, setNewLabel] = useState('')
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<HouseholdCheckpointManifest | null>(null)
  const [restoreReason, setRestoreReason] = useState('')

  if (!isOpen) return null

  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newLabel.trim()
    if (!trimmed || trimmed.length > 80 || isSubmitting) return
    await onSaveManualCheckpoint(trimmed)
    setNewLabel('')
  }

  const handleConfirmRestore = async () => {
    if (!selectedCheckpoint || !restoreReason.trim() || isSubmitting) return
    await onRestoreCheckpoint(selectedCheckpoint.checkpointId, restoreReason.trim())
    setSelectedCheckpoint(null)
    setRestoreReason('')
  }

  const kindBadge = (kind: HouseholdCheckpointManifest['kind']) => {
    switch (kind) {
      case 'MANUAL':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100 text-blue-800">手動</span>
      case 'PRE_SETTLEMENT':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-800">決算前自動</span>
      case 'PRE_RESTORE':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-purple-100 text-purple-800">復元前退避</span>
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-xl font-bold text-gray-900">
            チェックポイント管理・復元
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Create Manual Checkpoint */}
        <form onSubmit={handleSaveManual} className="bg-gray-50 p-4 rounded-lg border space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">手動チェックポイントの作成</h4>
          <div className="flex gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="例: 第2ラウンド開始前"
              maxLength={80}
              disabled={isSubmitting}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newLabel.trim() || newLabel.trim().length > 80 || isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition shadow-sm"
            >
              保存
            </button>
          </div>
          <p className="text-xs text-gray-500">現在のすべての家庭の状態をそのまま記録・保存します。</p>
        </form>

        {/* Checkpoint list */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">保存済みチェックポイント一覧</h4>
          {checkpoints.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">保存されたチェックポイントはありません。</p>
          ) : (
            <div className="divide-y border rounded-lg overflow-hidden">
              {checkpoints.map((cp) => {
                const incompatible = isIncompatibleV3Checkpoint(cp, currentAssignmentRevision)
                return (
                  <div key={cp.checkpointId} className="p-3 flex items-center justify-between hover:bg-gray-50 gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {kindBadge(cp.kind)}
                        <span className="text-sm font-medium text-gray-900">{cp.label}</span>
                      </div>
                      <div className="text-xs text-gray-500 flex gap-3">
                        <span>作成: {new Date(cp.createdAtServerMillis).toLocaleString('ja-JP')}</span>
                        {cp.expectedRoundIndex !== null && <span>対象ラウンド: 第{cp.expectedRoundIndex + 1}R</span>}
                        {cp.restoreGeneration > 0 && <span>第{cp.restoreGeneration}世代</span>}
                      </div>
                      {incompatible && (
                        <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 inline-block">
                          割り当て内容が変更されているため復元できません
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCheckpoint(cp)
                        setRestoreReason('')
                      }}
                      disabled={isSubmitting || incompatible}
                      title={incompatible ? 'このチェックポイントが記録された時点の家庭割り当てから、現在の割り当てが変更されているため復元できません。' : undefined}
                      className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      復元...
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Restore Confirmation Sub-Modal / Drawer */}
        {selectedCheckpoint && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-3">
            <h4 className="text-sm font-bold text-amber-900">チェックポイント復元の確認</h4>
            <p className="text-xs text-amber-800">
              「{selectedCheckpoint.label}」の状態にすべての家庭を復元します。現在の状態は自動的に「復元前退避チェックポイント」として保存されます。
            </p>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">復元の理由（必須）</label>
              <input
                type="text"
                value={restoreReason}
                onChange={(e) => setRestoreReason(e.target.value)}
                placeholder="例: 誤った決算のやり直し"
                disabled={isSubmitting}
                className="w-full rounded-lg border border-amber-300 px-3 py-1.5 text-sm bg-white focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedCheckpoint(null)}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={!restoreReason.trim() || isSubmitting}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                {isSubmitting ? '復元処理中...' : 'このチェックポイントに復元'}
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
