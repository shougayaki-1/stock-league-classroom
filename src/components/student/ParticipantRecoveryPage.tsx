import { useState } from 'react'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import type { Functions } from 'firebase/functions'
import type { Auth } from 'firebase/auth'
import { recoverParticipant, mapRecoveryError, type RecoveryErrorCode } from '../../lib/lessonRuns/recovery'
import { getOrCreateStudentUid } from '../../lib/auth/studentAuth'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

const ERROR_MESSAGES: Record<RecoveryErrorCode, string> = {
  UNAUTHENTICATED: 'ログインを確認できませんでした。もう一度お試しください。',
  INVALID_INPUT: 'コードの形式を確認してください。',
  PERMISSION_DENIED: 'この操作は許可されていません。教師に確認してください。',
  CODE_NOT_FOUND: 'コードが見つかりません。教師から伝えられたコードを確認してください。',
  CODE_ALREADY_USED_OR_EXPIRED: 'このコードはすでに使用済みか、期限が切れています。教師に新しいコードを発行してもらってください。',
  RECOVERY_CODE_ALREADY_ISSUED: '再接続に失敗しました。教師に新しいコードを発行してもらってください。',
  UNKNOWN: '再接続できませんでした。時間をおいて再度お試しください。',
}

const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`

export interface ParticipantRecoveryPageProps {
  lessonRunId: string
  functions: Functions
  auth: Auth
  /** Overridable for tests. */
  generateIdempotencyKey?: () => string
  onRecovered: () => void
}

/**
 * 新しい/別の端末で授業に再接続するための画面。参加者ID・認証UID・
 * 授業内部の識別子は一切入力させず、教師から口頭等で伝えられた再接続
 * コードだけを入力する。送信前にこの端末をまず匿名認証し(参加時と同じ
 * `getOrCreateStudentUid`)、新しい authUid を確立してから
 * `recoverParticipant` を呼ぶ — 呼び出し側はサーバー側で検証済みの認証
 * トークンから authUid を解決するため、クライアントから authUid を渡す
 * ことはない。
 */
export function ParticipantRecoveryPage({
  lessonRunId,
  functions,
  auth,
  generateIdempotencyKey: generateKey = generateIdempotencyKey,
  onRecovered,
}: ParticipantRecoveryPageProps) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

  const canSubmit = code.trim() !== '' && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setErrorMessage(undefined)
    try {
      await getOrCreateStudentUid(auth)
      await recoverParticipant(functions, {
        lessonRunId,
        code: code.trim(),
        idempotencyKey: generateKey(),
      })
      onRecovered()
    } catch (error) {
      setErrorMessage(ERROR_MESSAGES[mapRecoveryError(error)])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Stack
      component="form"
      spacing={2}
      sx={{ width: '100%', maxWidth: 480, p: 2, mx: 'auto' }}
      onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}
    >
      <Typography variant="h6" component="h1">授業に再接続する</Typography>
      <Typography variant="body2" color="text.secondary">
        教師から伝えられた再接続コードを入力してください。
      </Typography>

      {errorMessage && <Alert severity="error" role="alert">{errorMessage}</Alert>}

      <TextField
        id="recovery-code"
        label="再接続コード"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="教師から伝えられたコードを入力"
        slotProps={{ htmlInput: { 'aria-required': true } }}
        sx={{ '& .MuiInputBase-root': { minHeight: MIN_TOUCH_TARGET } }}
      />

      <Button
        type="submit"
        variant="contained"
        disabled={!canSubmit}
        sx={{ minHeight: MIN_TOUCH_TARGET }}
      >
        再接続する
      </Button>
    </Stack>
  )
}
