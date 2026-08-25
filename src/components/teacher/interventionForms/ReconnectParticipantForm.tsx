import { useState } from 'react'
import { Alert, Button, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import type { Functions } from 'firebase/functions'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'
import { issueRecoveryCode } from '../../../lib/lessonRuns/recovery'
import { describeError } from '../../../lib/monitoring/describeError'
import { formatParticipantStatus } from '../../../lib/presentation/lessonLabels'

export interface ReconnectParticipantFormParticipant {
  id: string
  displayName: string
  status?: string
}

export interface ReconnectParticipantFormProps {
  functions: Functions
  lessonRunId: string
  participants: ReconnectParticipantFormParticipant[]
  /** Overridable for tests; defaults to crypto.randomUUID() same as LessonControlRoom's generateIdempotencyKey. */
  generateIdempotencyKey?: () => string
}

/** Statuses where a reconnect is plausibly needed — participants outside this set (e.g. ACTIVE) are filtered out entirely, never rendered. */
const RECONNECT_RELEVANT_STATUSES = new Set(['TEMPORARILY_DISCONNECTED', 'MIGRATING_DEVICE', 'ABSENT'])

const UNKNOWN_DISPLAY_NAME_LABEL = '生徒名を確認できません'

const defaultIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`

/**
 * 再接続の専用フォーム。教師には生徒の表示名しか見せず、参加者ID・認証UID
 * はDOMに一切出さない。教師は生徒を選び「再接続コードを発行する」を押すと
 * issueRecoveryCode Callable を直接呼び出し、返ってきた再接続コード
 * （人が読み書きできるビアラーコード。参加コードと同様、表示して問題ない）
 * を大きく表示する。実際の再接続（新しい端末のauthUid解決）は生徒がこの
 * コードを入力したときに recoverParticipant Callable 側で行われる — ここ
 * では行わない。
 */
export function ReconnectParticipantForm({
  functions,
  lessonRunId,
  participants,
  generateIdempotencyKey = defaultIdempotencyKey,
}: ReconnectParticipantFormProps) {
  const [selected, setSelected] = useState<ReconnectParticipantFormParticipant | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const recoveryPagePath = `/lessons/${lessonRunId}/recover`
  const recoveryPageUrl = typeof window !== 'undefined' ? `${window.location.origin}${recoveryPagePath}` : recoveryPagePath

  const handleCopyRecoveryUrl = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(recoveryPageUrl).then(() => setCopied(true))
    }
  }

  const relevantParticipants = participants.filter((participant) => participant.status && RECONNECT_RELEVANT_STATUSES.has(participant.status))

  const displayLabel = (participant: ReconnectParticipantFormParticipant): string =>
    participant.displayName.trim() || UNKNOWN_DISPLAY_NAME_LABEL

  if (selected && code) {
    return (
      <Stack spacing={1}>
        <Alert severity="success">{displayLabel(selected)} の再接続コードを発行しました。</Alert>
        <Typography
          variant="h4"
          component="p"
          sx={{ fontWeight: 700, letterSpacing: '0.15em', textAlign: 'center' }}
        >
          {code}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          このコードを{displayLabel(selected)}さんに伝えてください。新しい端末でこの授業の再接続ページを開き、コードを入力すると元の状態に戻れます。
        </Typography>
        <Button
          component="a"
          href={recoveryPagePath}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          sx={{ minHeight: MIN_TOUCH_TARGET }}
        >
          再接続ページを開く
        </Button>
        <Button
          variant="outlined"
          sx={{ minHeight: MIN_TOUCH_TARGET }}
          onClick={handleCopyRecoveryUrl}
        >
          再接続ページのURLをコピー
        </Button>
        {copied && <Alert severity="success">URLをコピーしました。</Alert>}
        <Button
          variant="text"
          sx={{ minHeight: MIN_TOUCH_TARGET }}
          onClick={() => { setSelected(null); setCode(null); setError(null); setCopied(false) }}
        >
          別の参加者を再接続する
        </Button>
      </Stack>
    )
  }

  if (!selected) {
    if (relevantParticipants.length === 0) {
      return <Typography variant="body2" color="text.secondary">再接続が必要な参加者がいません。</Typography>
    }
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">再接続する生徒を選んでください。</Typography>
        <List>
          {relevantParticipants.map((participant) => (
            <ListItemButton
              key={participant.id}
              sx={{ minHeight: MIN_TOUCH_TARGET }}
              onClick={() => { setSelected(participant); setError(null) }}
            >
              <ListItemText
                primary={displayLabel(participant)}
                secondary={participant.status ? formatParticipantStatus(participant.status) : undefined}
              />
            </ListItemButton>
          ))}
        </List>
      </Stack>
    )
  }

  const handleIssue = async () => {
    setIssuing(true)
    setError(null)
    try {
      const result = await issueRecoveryCode(functions, {
        lessonRunId,
        participantId: selected.id,
        idempotencyKey: generateIdempotencyKey(),
      })
      setCode(result.code)
    } catch (issueError) {
      setError(describeError(issueError, '再接続コードの発行に失敗しました。もう一度お試しください。'))
    } finally {
      setIssuing(false)
    }
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {displayLabel(selected)}さんの再接続コードを発行します。よろしいですか？
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Button variant="contained" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => { void handleIssue() }} disabled={issuing}>
        再接続コードを発行する
      </Button>
      <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => { setSelected(null); setError(null) }}>戻る</Button>
    </Stack>
  )
}
