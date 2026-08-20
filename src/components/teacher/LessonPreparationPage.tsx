import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import RefreshIcon from '@mui/icons-material/Refresh'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { Database } from 'firebase/database'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'
import { subscribePublicRun } from '../../lib/lessonRuns/liveRepository'
import type { LessonRunPublicState } from '../../lib/lessonRuns/liveTypes'
import { subscribeLessonParticipants, type LessonParticipantView } from '../../lib/lessonRuns/participants'
import { transitionPhase } from '../../lib/lessonRuns/transitionPhase'
import { issueJoinCode, invalidateJoinCode } from '../../lib/lessonRuns/joinCodes'
import { issueDisplaySessionToken } from '../../lib/lessonRuns/displaySession'
import { describeError } from '../../lib/monitoring/describeError'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

export interface LessonPreparationPageProps {
  lessonRunId: string
  functions: Functions
  firestore: Firestore
  database: Database
  initialStatus?: string
  initialJoinCode?: string | null
  onStartLesson?: () => Promise<void> | void
}

const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`

export function LessonPreparationPage({
  lessonRunId,
  functions,
  firestore,
  database,
  initialStatus,
  initialJoinCode = null,
  onStartLesson,
}: LessonPreparationPageProps) {
  const navigate = useNavigate()
  const [publicState, setPublicState] = useState<LessonRunPublicState | null>(null)
  const [localStatus, setLocalStatus] = useState<string | null>(null)
  const [participants, setParticipants] = useState<LessonParticipantView[]>([])
  const [joinCode, setJoinCode] = useState<string | null>(initialJoinCode)
  const [displayToken, setDisplayToken] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [reissuingCode, setReissuingCode] = useState(false)
  const [reissuingToken, setReissuingToken] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()
  const [copySuccess, setCopySuccess] = useState(false)

  useEffect(() => subscribePublicRun(database, lessonRunId, setPublicState), [database, lessonRunId])
  useEffect(() => subscribeLessonParticipants(firestore, lessonRunId, setParticipants), [firestore, lessonRunId])

  const status = publicState?.status ?? localStatus ?? initialStatus ?? 'DRAFT'

  // If the lesson is already RUNNING or later, redirect to control room
  if (
    status === 'RUNNING' ||
    status === 'PAUSED' ||
    status === 'INTERRUPTED' ||
    status === 'REFLECTION' ||
    status === 'COMPLETED' ||
    status === 'ABORTED' ||
    status === 'ARCHIVED'
  ) {
    return <Navigate replace to={`/teacher/lessons/${lessonRunId}/control`} />
  }

  const handlePrepareLesson = async () => {
    setPreparing(true)
    setError(undefined)
    try {
      // 1. DRAFT -> READY
      await transitionPhase(functions, {
        lessonRunId,
        targetStatus: 'READY',
        reason: '教師操作: 授業準備',
        idempotencyKey: generateIdempotencyKey(),
      })
      // 2. READY -> WAITING
      await transitionPhase(functions, {
        lessonRunId,
        targetStatus: 'WAITING',
        reason: '教師操作: 授業準備',
        idempotencyKey: generateIdempotencyKey(),
      })
      // 3. Issue join code
      const codeResult = await issueJoinCode(functions, { lessonRunId })
      setJoinCode(codeResult.code)

      // 4. Issue display session token
      const tokenResult = await issueDisplaySessionToken(functions, { lessonRunId })
      setDisplayToken(tokenResult.token)
      setLocalStatus('WAITING')
    } catch (err) {
      setError(describeError(err, '授業の準備に失敗しました。もう一度お試しください。'))
    } finally {
      setPreparing(false)
    }
  }

  const handleReissueCode = async () => {
    if (!joinCode) return
    setReissuingCode(true)
    setError(undefined)
    try {
      await invalidateJoinCode(functions, { lessonRunId, code: joinCode })
      const codeResult = await issueJoinCode(functions, { lessonRunId })
      setJoinCode(codeResult.code)
    } catch (err) {
      setError(describeError(err, '参加コードの再発行に失敗しました。'))
    } finally {
      setReissuingCode(false)
    }
  }

  const handleReissueDisplayToken = async () => {
    setReissuingToken(true)
    setError(undefined)
    try {
      const tokenResult = await issueDisplaySessionToken(functions, { lessonRunId })
      setDisplayToken(tokenResult.token)
    } catch (err) {
      setError(describeError(err, '教室表示URLの再発行に失敗しました。'))
    } finally {
      setReissuingToken(false)
    }
  }

  const handleStartLessonInternal = async () => {
    setStarting(true)
    setError(undefined)
    try {
      if (onStartLesson) {
        await onStartLesson()
      } else {
        await transitionPhase(functions, {
          lessonRunId,
          targetStatus: 'RUNNING',
          reason: '教師操作: 授業開始',
          idempotencyKey: generateIdempotencyKey(),
        })
        await transitionPhase(functions, {
          lessonRunId,
          targetPhaseId: 'intro',
          reason: '教師操作: 授業開始',
          idempotencyKey: generateIdempotencyKey(),
        })
      }
      navigate(`/teacher/lessons/${lessonRunId}/control`)
    } catch (err) {
      setError(describeError(err, '授業の開始に失敗しました。'))
      setStarting(false)
    }
  }

  const displayUrl = displayToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/display/${lessonRunId}?token=${displayToken}`
    : null

  const handleCopyDisplayUrl = () => {
    if (!displayUrl) return
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(displayUrl).then(() => setCopySuccess(true))
    }
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 800, mx: 'auto', p: { xs: 2, sm: 3 } }}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 'bold' }} gutterBottom>
          授業の準備
        </Typography>
        {publicState?.title && (
          <Typography variant="subtitle1" color="text.secondary">
            {publicState.title}
          </Typography>
        )}
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(undefined)}>
          {error}
        </Alert>
      )}

      {status === 'DRAFT' ? (
        <Card variant="outlined">
          <CardContent sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" gutterBottom>
              授業を開始する準備を整えましょう
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
              参加コードと教室投影用URLを発行し、生徒の入室待機状態（WAITING）に進めます。
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={handlePrepareLesson}
              disabled={preparing}
              startIcon={preparing ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
              sx={{ minHeight: MIN_TOUCH_TARGET, px: 4, py: 1.5, fontSize: '1.1rem' }}
            >
              {preparing ? '準備中...' : '授業の準備をする'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={3}>
          {/* Join Code Card */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                生徒用 参加コード
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ my: 1, alignItems: { xs: 'flex-start', sm: 'center' } }} spacing={2}>
                <Paper
                  variant="outlined"
                  sx={{
                    px: 3,
                    py: 1.5,
                    bgcolor: 'grey.50',
                    letterSpacing: '0.3em',
                    fontWeight: 'bold',
                    fontSize: '2rem',
                    fontFamily: 'monospace',
                  }}
                >
                  {joinCode || '------'}
                </Paper>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleReissueCode}
                  disabled={reissuingCode || !joinCode}
                  startIcon={reissuingCode ? <CircularProgress size={16} /> : <RefreshIcon />}
                  sx={{ minHeight: MIN_TOUCH_TARGET }}
                >
                  参加コードを作り直す
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                ※ 生徒は /join からこのコードを入力するか、教室表示のQRコードを読み取って参加します。
              </Typography>
            </CardContent>
          </Card>

          {/* Classroom Display Card */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                プロジェクター・電子黒板向け 教室表示
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                教室の大画面に投影する表示用URLです。参加コードやQRコード、授業の進行状況が自動で映し出されます。
              </Typography>

              {displayUrl ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    color="primary"
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    startIcon={<OpenInNewIcon />}
                    sx={{ minHeight: MIN_TOUCH_TARGET }}
                  >
                    教室表示を開く
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleCopyDisplayUrl}
                    startIcon={<ContentCopyIcon />}
                    sx={{ minHeight: MIN_TOUCH_TARGET }}
                  >
                    表示用URLをコピー
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleReissueDisplayToken}
                    disabled={reissuingToken}
                    startIcon={reissuingToken ? <CircularProgress size={16} /> : <RefreshIcon />}
                    sx={{ minHeight: MIN_TOUCH_TARGET }}
                  >
                    教室表示のURLを再発行
                  </Button>
                </Stack>
              ) : (
                <Button
                  variant="contained"
                  onClick={handleReissueDisplayToken}
                  disabled={reissuingToken}
                  startIcon={reissuingToken ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                  sx={{ minHeight: MIN_TOUCH_TARGET }}
                >
                  表示用URLを発行する
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Participants Card */}
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  参加者一覧
                </Typography>
                <Typography variant="body2" color="primary" sx={{ fontWeight: 'bold' }}>
                  現在 {participants.length} 人
                </Typography>
              </Stack>
              <Divider sx={{ my: 1 }} />
              {participants.length === 0 ? (
                <Box sx={{ py: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    生徒の参加を待っています...
                  </Typography>
                </Box>
              ) : (
                <List dense disablePadding sx={{ maxHeight: 240, overflowY: 'auto' }}>
                  {participants.map((participant) => (
                    <ListItem key={participant.id} divider sx={{ py: 0.75 }}>
                      <ListItemText
                        primary={participant.displayName}
                        secondary={participant.status === 'ACTIVE' ? '参加中' : participant.status}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>

          {/* Start Lesson CTA Card */}
          <Paper elevation={2} sx={{ p: 3, bgcolor: 'primary.50', border: 1, borderColor: 'primary.200' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' } }} spacing={2}>
              <Box>
                <Typography variant="subtitle1" color="primary.dark" sx={{ fontWeight: 'bold' }}>
                  生徒が揃ったら授業を開始しましょう
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  「授業を開始」を押すと、第1フェーズ（導入フェーズ）に進みます。
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="primary"
                size="large"
                onClick={handleStartLessonInternal}
                disabled={starting}
                startIcon={starting ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
                sx={{ minHeight: MIN_TOUCH_TARGET, px: 3, py: 1.25, whiteSpace: 'nowrap' }}
              >
                {starting ? '開始中...' : '授業を開始'}
              </Button>
            </Stack>
          </Paper>
        </Stack>
      )}

      <Snackbar
        open={copySuccess}
        autoHideDuration={3000}
        onClose={() => setCopySuccess(false)}
        message="表示用URLをクリップボードにコピーしました"
      />
    </Stack>
  )
}
