import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { AiBetaAccessListItem } from '../../lib/ai/betaAccess'

export interface OperatorAiBetaAccessPageProps {
  items: AiBetaAccessListItem[]
  loading: boolean
  mutating: boolean
  accessDenied: boolean
  error?: string
  onGrant: (email: string, reason: string) => Promise<void>
  onRevoke: (teacherUid: string, reason: string) => Promise<void>
  onNavigateHome?: () => void
  onNavigateToReports: () => void
  onNavigateToCertifications: () => void
}

export function OperatorAiBetaAccessPage({
  items,
  loading,
  mutating,
  accessDenied,
  error,
  onGrant,
  onRevoke,
  onNavigateHome,
  onNavigateToReports,
  onNavigateToCertifications,
}: OperatorAiBetaAccessPageProps) {
  const [grantEmail, setGrantEmail] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [grantError, setGrantError] = useState<string>()

  const [revokingTarget, setRevokingTarget] = useState<AiBetaAccessListItem | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeError, setRevokeError] = useState<string>()

  if (accessDenied) {
    return (
      <Stack sx={{ p: 2 }}>
        <Typography color="error">この画面は運営者のみ利用できます。</Typography>
      </Stack>
    )
  }

  const handleGrantSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = grantEmail.trim()
    const trimmedReason = grantReason.trim()
    if (!trimmedEmail || !trimmedReason) return

    setGrantError(undefined)
    try {
      await onGrant(trimmedEmail, trimmedReason)
      setGrantEmail('')
      setGrantReason('')
    } catch (err: unknown) {
      setGrantError(err instanceof Error ? err.message : '許可の付与に失敗しました。')
    }
  }

  const handleRevokeConfirm = async () => {
    if (!revokingTarget) return
    const trimmedReason = revokeReason.trim()
    if (!trimmedReason) return

    setRevokeError(undefined)
    try {
      await onRevoke(revokingTarget.teacherUid, trimmedReason)
      setRevokingTarget(null)
      setRevokeReason('')
    } catch (err: unknown) {
      setRevokeError(err instanceof Error ? err.message : '許可の取り消しに失敗しました。')
    }
  }

  const isGrantValid =
    grantEmail.trim().length > 0 && grantReason.trim().length > 0 && !mutating

  return (
    <Stack spacing={3} sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5">AI Lesson Studio 限定ベータアクセス管理</Typography>
        <Stack direction="row" spacing={1}>
          {onNavigateHome && (
            <Button variant="text" onClick={onNavigateHome}>
              運営者ページへ
            </Button>
          )}
          <Button variant="outlined" onClick={onNavigateToReports}>
            通報の審査へ
          </Button>
          <Button variant="outlined" onClick={onNavigateToCertifications}>
            教材認定へ
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Grant Access Form */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            新規許可の付与
          </Typography>
          {grantError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {grantError}
            </Alert>
          )}
          <Box component="form" onSubmit={handleGrantSubmit}>
            <Stack spacing={2}>
              <TextField
                label="教師メールアドレス"
                placeholder="teacher@example.com"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                disabled={mutating}
                fullWidth
                required
              />
              <TextField
                label="許可理由"
                placeholder="ベータ参加承認理由 (1〜500文字)"
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                disabled={mutating}
                multiline
                rows={2}
                fullWidth
                required
              />
              <Button
                type="submit"
                variant="contained"
                disabled={!isGrantValid}
                sx={{ alignSelf: 'flex-start' }}
              >
                {mutating ? <CircularProgress size={20} /> : '許可を付与'}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      {/* Approved Teachers List */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            許可済み教師一覧
          </Typography>
          {loading ? (
            <CircularProgress aria-label="読み込み中" />
          ) : items.length === 0 ? (
            <Typography color="text.secondary">許可された教師アカウントはありません。</Typography>
          ) : (
            <List>
              {items.map((item) => (
                <ListItem
                  key={item.teacherUid}
                  divider
                  secondaryAction={
                    <Button
                      color="error"
                      variant="outlined"
                      size="small"
                      disabled={mutating}
                      onClick={() => {
                        setRevokingTarget(item)
                        setRevokeReason('')
                        setRevokeError(undefined)
                      }}
                    >
                      許可を取り消す
                    </Button>
                  }
                >
                  <ListItemText
                    primary={item.email || item.teacherUid}
                    secondary={
                      <>
                        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
                          UID: {item.teacherUid}
                        </Typography>
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          許可日時: {new Date(item.approvedAtMillis).toLocaleString()} | 許可者: {item.approvedByUid}
                        </Typography>
                      </>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* Revoke Confirmation Dialog */}
      <Dialog
        open={Boolean(revokingTarget)}
        onClose={() => !mutating && setRevokingTarget(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>AIベータアクセスの取り消し</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <DialogContentText>
              {revokingTarget?.email || revokingTarget?.teacherUid} のAIベータアクセスを取り消します。
              既存の作成済み教材やアップロード済み資料は維持されますが、今後のAI機能利用および新規資料アップロードは拒否されます。
            </DialogContentText>

            {revokeError && <Alert severity="error">{revokeError}</Alert>}

            <TextField
              label="取消理由"
              placeholder="取り消し理由を入力してください (必須)"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              disabled={mutating}
              multiline
              rows={2}
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokingTarget(null)} disabled={mutating}>
            キャンセル
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!revokeReason.trim() || mutating}
            onClick={handleRevokeConfirm}
          >
            {mutating ? <CircularProgress size={20} /> : '取消を実行'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
