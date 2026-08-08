import { useState } from 'react'
import { Alert, Button, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import type { Functions } from 'firebase/functions'
import {
  joinLessonRun, mapJoinLessonRunError,
  type JoinLessonErrorCode, type JoinLessonRunResult,
} from '../../lib/lessonRuns/joinLessonRun'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

const IDENTITY_MODE_LABELS: Record<'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE', string> = {
  SCHOOL_ACCOUNT: '学校アカウントでログイン',
  QUICK_JOIN: '簡単参加(名前と出席番号だけ)',
  TEAM_DEVICE: 'チーム端末で参加(1台をチームで共有)',
}

const ERROR_MESSAGES: Record<JoinLessonErrorCode, string> = {
  UNAUTHENTICATED: 'ログインが確認できませんでした。もう一度お試しください。',
  INVALID_INPUT: '入力内容を確認してください。',
  JOIN_CODE_NOT_FOUND: '参加コードが見つかりません。教師に確認してください。',
  LESSON_NOT_ACCEPTING_PARTICIPANTS: 'この授業は現在参加を受け付けていません。',
  LESSON_FULL: '定員に達しているため参加できません。',
  PARTICIPANT_SUSPENDED: 'この端末/アカウントは参加を停止されています。教師に確認してください。',
  UNKNOWN: '参加できませんでした。時間をおいて再度お試しください。',
}

const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`

export interface LessonJoinPageProps {
  functions: Functions
  /** QRディープリンクのクエリ等から渡された参加コード。渡された場合は入力欄に事前入力する。 */
  initialJoinCode?: string
  /**
   * 参加成功時に呼ばれる。`result.duplicateIdentifierWarning` が true でも、
   * この画面は生徒本人にその警告を一切表示しない — 重複識別番号の警告は
   * 教師のParticipantMonitor(Task11)だけが表示する設計(ブリーフStep1)。
   * 呼び出し側(親)がこの結果を使って待機画面へ遷移する。
   */
  onJoined: (result: JoinLessonRunResult) => void
}

/**
 * 生徒の参加画面(Task12)。QRディープリンク/参加コード入力の両方から
 * 到達でき(`initialJoinCode`があれば事前入力)、3つの識別方式
 * (学校アカウント/簡単参加/チーム端末)を選べる。`joinLessonRun`(Task3)
 * を直接呼び出す薄いコンテナ。
 */
export function LessonJoinPage({ functions, initialJoinCode, onJoined }: LessonJoinPageProps) {
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? '')
  const [identityMode, setIdentityMode] = useState<'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'>('QUICK_JOIN')
  const [displayName, setDisplayName] = useState('')
  const [externalIdentifier, setExternalIdentifier] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

  const canSubmit = joinCode.trim() !== '' && displayName.trim() !== '' && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setErrorMessage(undefined)
    try {
      const result = await joinLessonRun(functions, {
        joinCode: joinCode.trim(),
        identityMode,
        displayName: displayName.trim(),
        externalIdentifier: externalIdentifier.trim() || undefined,
        idempotencyKey: generateIdempotencyKey(),
      })
      // duplicateIdentifierWarning is intentionally dropped here — never
      // surfaced to the student (see this component's JSDoc / onJoined's).
      onJoined(result)
    } catch (error) {
      setErrorMessage(ERROR_MESSAGES[mapJoinLessonRunError(error)])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Stack
      component="form"
      spacing={2}
      sx={{ width: '100%', maxWidth: 480, p: 2 }}
      onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}
    >
      <Typography variant="h6" component="h1">授業に参加する</Typography>

      {errorMessage && <Alert severity="error" role="alert">{errorMessage}</Alert>}

      <TextField
        id="join-code"
        label="参加コード"
        value={joinCode}
        onChange={(e) => setJoinCode(e.target.value)}
        placeholder="教師から共有されたコードを入力"
        slotProps={{ htmlInput: { 'aria-required': true } }}
        sx={{ '& .MuiInputBase-root': { minHeight: MIN_TOUCH_TARGET } }}
      />

      <FormControl component="fieldset">
        <FormLabel component="legend">参加方法</FormLabel>
        <RadioGroup
          value={identityMode}
          onChange={(e) => setIdentityMode(e.target.value as typeof identityMode)}
        >
          {(Object.keys(IDENTITY_MODE_LABELS) as Array<keyof typeof IDENTITY_MODE_LABELS>).map((mode) => (
            <FormControlLabel
              key={mode}
              value={mode}
              control={<Radio sx={{ p: 1.25 }} />}
              label={IDENTITY_MODE_LABELS[mode]}
              sx={{ minHeight: MIN_TOUCH_TARGET }}
            />
          ))}
        </RadioGroup>
      </FormControl>

      <TextField
        id="display-name"
        label="表示名"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="クラスで使う名前"
        slotProps={{ htmlInput: { 'aria-required': true } }}
        sx={{ '& .MuiInputBase-root': { minHeight: MIN_TOUCH_TARGET } }}
      />

      <TextField
        id="external-identifier"
        label="出席番号など(任意)"
        value={externalIdentifier}
        onChange={(e) => setExternalIdentifier(e.target.value)}
        sx={{ '& .MuiInputBase-root': { minHeight: MIN_TOUCH_TARGET } }}
      />

      <Button
        type="submit"
        variant="contained"
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        sx={{ minHeight: MIN_TOUCH_TARGET }}
      >
        参加する
      </Button>
    </Stack>
  )
}
