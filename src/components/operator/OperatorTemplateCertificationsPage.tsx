import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { CertificationCandidate } from '../../lib/lessonTemplates/templateCertification'

export interface OperatorTemplateCertificationsPageProps {
  candidates: CertificationCandidate[]
  loading: boolean
  accessDenied: boolean
  onSetCertification: (
    candidate: CertificationCandidate,
    level: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL',
    reason: string,
  ) => Promise<void>
  onNavigateToReports?: () => void
  onNavigateToAiBeta?: () => void
}

const VISIBILITY_LABELS: Record<string, string> = {
  COMMUNITY: '通常公開',
  VERIFIED: '認証済み',
  OFFICIAL: '公式',
}

const VISIBILITY_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success'> = {
  COMMUNITY: 'default',
  VERIFIED: 'primary',
  OFFICIAL: 'secondary',
}

export function OperatorTemplateCertificationsPage({
  candidates,
  loading,
  accessDenied,
  onSetCertification,
  onNavigateToReports,
  onNavigateToAiBeta,
}: OperatorTemplateCertificationsPageProps) {
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})

  if (accessDenied) {
    return (
      <Stack sx={{ p: 2 }}>
        <Typography color="error">この画面は運営者のみ利用できます。</Typography>
      </Stack>
    )
  }

  const handleReasonChange = (templateId: string, value: string) => {
    setReasons((prev) => ({ ...prev, [templateId]: value }))
  }

  const handleAction = async (
    candidate: CertificationCandidate,
    level: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL',
  ) => {
    const reason = reasons[candidate.templateId]?.trim() || ''
    if (!reason) return

    setActionLoading((prev) => ({ ...prev, [candidate.templateId]: true }))
    setErrors((prev) => ({ ...prev, [candidate.templateId]: null }))

    try {
      await onSetCertification(candidate, level, reason)
      setReasons((prev) => ({ ...prev, [candidate.templateId]: '' }))
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : '認定の更新に失敗しました。'
      setErrors((prev) => ({ ...prev, [candidate.templateId]: message }))
    } finally {
      setActionLoading((prev) => ({ ...prev, [candidate.templateId]: false }))
    }
  }

  return (
    <Stack spacing={2} sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5">公開教材の認定管理</Typography>
        <Stack direction="row" spacing={1}>
          {onNavigateToReports && (
            <Button variant="outlined" onClick={onNavigateToReports}>
              通報の審査へ
            </Button>
          )}
          {onNavigateToAiBeta && (
            <Button variant="outlined" onClick={onNavigateToAiBeta}>
              AIベータ管理へ
            </Button>
          )}
        </Stack>
      </Stack>

      {loading ? (
        <CircularProgress aria-label="読み込み中" />
      ) : candidates.length === 0 ? (
        <Typography color="text.secondary">公開中の教材はありません。</Typography>
      ) : (
        <Stack spacing={2}>
          {candidates.map((candidate) => {
            const reason = reasons[candidate.templateId] ?? ''
            const isSubmitting = actionLoading[candidate.templateId] ?? false
            const isReasonValid = reason.trim().length > 0 && reason.trim().length <= 500
            const currentError = errors[candidate.templateId]

            return (
              <Card key={candidate.templateId} variant="outlined">
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Box>
                        <Typography variant="h6" component="div">
                          {candidate.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ID: {candidate.templateId} | 版: {candidate.currentPublishedVersionId} | 作成者: {candidate.createdByUid}
                        </Typography>
                      </Box>
                      <Chip
                        label={VISIBILITY_LABELS[candidate.visibility] ?? candidate.visibility}
                        color={VISIBILITY_COLORS[candidate.visibility] ?? 'default'}
                        size="small"
                      />
                    </Stack>

                    {currentError && (
                      <Alert severity="error" onClose={() => setErrors((prev) => ({ ...prev, [candidate.templateId]: null }))}>
                        {currentError}
                      </Alert>
                    )}

                    <TextField
                      label="審査・変更理由"
                      placeholder="理由を入力してください (1〜500文字)"
                      size="small"
                      fullWidth
                      multiline
                      rows={2}
                      value={reason}
                      onChange={(e) => handleReasonChange(candidate.templateId, e.target.value)}
                      disabled={isSubmitting}
                    />

                    <Divider />

                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <Button
                        variant={candidate.visibility === 'COMMUNITY' ? 'outlined' : 'contained'}
                        color="inherit"
                        size="small"
                        disabled={!isReasonValid || isSubmitting || candidate.visibility === 'COMMUNITY'}
                        onClick={() => handleAction(candidate, 'COMMUNITY')}
                      >
                        通常公開に戻す
                      </Button>
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        disabled={!isReasonValid || isSubmitting || candidate.visibility === 'VERIFIED'}
                        onClick={() => handleAction(candidate, 'VERIFIED')}
                      >
                        認証済み (VERIFIED) にする
                      </Button>
                      <Button
                        variant="contained"
                        color="secondary"
                        size="small"
                        disabled={!isReasonValid || isSubmitting || candidate.visibility === 'OFFICIAL'}
                        onClick={() => handleAction(candidate, 'OFFICIAL')}
                      >
                        公式 (OFFICIAL) にする
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
