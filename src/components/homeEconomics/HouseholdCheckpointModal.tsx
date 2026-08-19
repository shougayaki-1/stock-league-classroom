import React, { useState } from 'react'
import { Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
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

const KIND_BADGE: Record<HouseholdCheckpointManifest['kind'], { label: string; bg: string; color: string }> = {
  MANUAL: { label: '手動', bg: 'primary.light', color: 'primary.dark' },
  PRE_SETTLEMENT: { label: '決算前自動', bg: 'warning.light', color: 'warning.dark' },
  PRE_RESTORE: { label: '復元前退避', bg: '#f3e8fd', color: '#6a1b9a' },
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
    const badge = KIND_BADGE[kind]
    return (
      <Box component="span" sx={{ px: 1, py: 0.25, fontSize: '0.75rem', fontWeight: 600, borderRadius: 1, bgcolor: badge.bg, color: badge.color }}>
        {badge.label}
      </Box>
    )
  }

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.5)', p: 2 }}>
      <Stack spacing={3} sx={{ width: '100%', maxWidth: 672, borderRadius: '12px', bgcolor: 'background.paper', p: 3, boxShadow: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider', pb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            チェックポイント管理・復元
          </Typography>
          <IconButton onClick={onClose} disabled={isSubmitting} aria-label="閉じる" size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {/* Create Manual Checkpoint */}
        <Stack component="form" onSubmit={handleSaveManual} spacing={1.5} sx={{ bgcolor: 'grey.50', border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>手動チェックポイントの作成</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="例: 第2ラウンド開始前"
              slotProps={{ htmlInput: { maxLength: 80 } }}
              disabled={isSubmitting}
              sx={{ flex: 1 }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={!newLabel.trim() || newLabel.trim().length > 80 || isSubmitting}
            >
              保存
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">現在のすべての家庭の状態をそのまま記録・保存します。</Typography>
        </Stack>

        {/* Checkpoint list */}
        <Stack spacing={1.5}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>保存済みチェックポイント一覧</Typography>
          {checkpoints.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>保存されたチェックポイントはありません。</Typography>
          ) : (
            <Stack sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', '& > *:not(:last-child)': { borderBottom: 1, borderColor: 'divider' } }}>
              {checkpoints.map((cp) => {
                const incompatible = isIncompatibleV3Checkpoint(cp, currentAssignmentRevision)
                return (
                  <Stack
                    key={cp.checkpointId}
                    direction="row"
                    spacing={2}
                    sx={{ p: 1.5, alignItems: 'center', justifyContent: 'space-between', '&:hover': { bgcolor: 'grey.50' } }}
                  >
                    <Stack spacing={0.5}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        {kindBadge(cp.kind)}
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{cp.label}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={1.5}>
                        <Typography variant="caption" color="text.secondary">作成: {new Date(cp.createdAtServerMillis).toLocaleString('ja-JP')}</Typography>
                        {cp.expectedRoundIndex !== null && <Typography variant="caption" color="text.secondary">対象ラウンド: 第{cp.expectedRoundIndex + 1}R</Typography>}
                        {cp.restoreGeneration > 0 && <Typography variant="caption" color="text.secondary">第{cp.restoreGeneration}世代</Typography>}
                      </Stack>
                      {incompatible && (
                        <Box component="span" sx={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, color: 'error.dark', bgcolor: 'error.light', border: 1, borderColor: 'error.main', borderRadius: 1, px: 0.75, py: 0.25 }}>
                          割り当て内容が変更されているため復元できません
                        </Box>
                      )}
                    </Stack>

                    <Button
                      variant="outlined"
                      color="warning"
                      size="small"
                      onClick={() => {
                        setSelectedCheckpoint(cp)
                        setRestoreReason('')
                      }}
                      disabled={isSubmitting || incompatible}
                      title={incompatible ? 'このチェックポイントが記録された時点の家庭割り当てから、現在の割り当てが変更されているため復元できません。' : undefined}
                    >
                      復元...
                    </Button>
                  </Stack>
                )
              })}
            </Stack>
          )}
        </Stack>

        {/* Restore Confirmation Sub-Modal / Drawer */}
        {selectedCheckpoint && (
          <Stack spacing={1.5} sx={{ p: 2, bgcolor: 'warning.light', border: 1, borderColor: 'warning.main', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'warning.dark' }}>チェックポイント復元の確認</Typography>
            <Typography variant="caption" sx={{ color: 'warning.dark' }}>
              「{selectedCheckpoint.label}」の状態にすべての家庭を復元します。現在の状態は自動的に「復元前退避チェックポイント」として保存されます。
            </Typography>
            <Stack spacing={0.5}>
              <Typography component="label" variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>復元の理由（必須）</Typography>
              <TextField
                size="small"
                value={restoreReason}
                onChange={(e) => setRestoreReason(e.target.value)}
                placeholder="例: 誤った決算のやり直し"
                disabled={isSubmitting}
                sx={{ bgcolor: 'background.paper' }}
              />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', pt: 1 }}>
              <Button size="small" variant="text" color="inherit" onClick={() => setSelectedCheckpoint(null)} disabled={isSubmitting}>
                キャンセル
              </Button>
              <Button
                size="small"
                variant="contained"
                color="warning"
                onClick={() => { void handleConfirmRestore() }}
                disabled={!restoreReason.trim() || isSubmitting}
              >
                {isSubmitting ? '復元処理中...' : 'このチェックポイントに復元'}
              </Button>
            </Stack>
          </Stack>
        )}

        <Stack direction="row" sx={{ justifyContent: 'flex-end', pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button variant="text" color="inherit" onClick={onClose} disabled={isSubmitting}>
            閉じる
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
