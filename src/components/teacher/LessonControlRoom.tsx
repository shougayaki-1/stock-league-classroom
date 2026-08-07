import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Stack } from '@mui/material'
import type { Database } from 'firebase/database'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'
import { applyTeacherIntervention, canApplyIntervention, type LessonInterventionType } from '../../lib/lessonRuns/interventions'
import { canControlLesson, type LessonRunRole } from '../../lib/lessonRuns/authorization'
import { subscribeDisplayRun, subscribePublicRun } from '../../lib/lessonRuns/liveRepository'
import type { LessonRunDisplayState, LessonRunPublicState } from '../../lib/lessonRuns/liveTypes'
import { subscribeLessonParticipants, type LessonParticipantView } from '../../lib/lessonRuns/participants'
import { completeLesson, interruptLesson, resumeLesson } from '../../lib/lessonRuns/lifecycle'
import { LessonStatusHeader } from './LessonStatusHeader'
import { ParticipantMonitor } from './ParticipantMonitor'
import { InterventionPanel, type InterventionApplyInput } from './InterventionPanel'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

const DISPLAY_MODE_LABEL: Record<LessonRunDisplayState['mode'], string> = {
  START: '開始待機画面',
  LIVE: '進行中の画面',
  END: '終了画面',
  EXPLANATION: '説明スライド',
}

const DISCONNECTED_STATUSES: ReadonlySet<LessonParticipantView['status']> = new Set([
  'TEMPORARILY_DISCONNECTED',
  'MIGRATING_DEVICE',
  'ABSENT',
])

/** Same team-imbalance judgment call as ParticipantMonitor.tsx — kept in sync intentionally rather than shared, since this is the only other call site. */
const IMBALANCE_THRESHOLD = 2

function teamSizeImbalance(participants: LessonParticipantView[]): boolean {
  const sizes = new Map<string, number>()
  for (const p of participants) {
    if (!p.teamId) continue
    sizes.set(p.teamId, (sizes.get(p.teamId) ?? 0) + 1)
  }
  const counts = [...sizes.values()]
  if (counts.length < 2) return false
  return Math.max(...counts) - Math.min(...counts) >= IMBALANCE_THRESHOLD
}

function hasDuplicateIdentifiers(participants: LessonParticipantView[]): boolean {
  const seen = new Set<string>()
  for (const p of participants) {
    if (!p.externalIdentifier) continue
    if (seen.has(p.externalIdentifier)) return true
    seen.add(p.externalIdentifier)
  }
  return false
}

const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`

export interface LessonControlRoomProps {
  lessonRunId: string
  /** This teacher's role for THIS lesson run — resolved by the caller from LessonRun.teacherRoles (no client wrapper exists to fetch a single doc; out of this task's scope, see task-11-report.md). */
  role: LessonRunRole
  functions: Functions
  firestore: Firestore
  database: Database
  /** 名簿上の想定参加者数。分かっている場合のみ ParticipantMonitor の「未参加」件数を計算する。 */
  expectedParticipantCount?: number
  /**
   * Invoked when the primary CTA is "授業を開始" (status DRAFT/READY/WAITING).
   * The actual `transitionPhase` call (Task 5) is left to the caller because
   * choosing `targetStatus`/`targetPhaseId` requires the lesson's phase-graph
   * (template) knowledge that this screen component does not have — see
   * functions/src/lessonRuns/phases/transitionPhase.ts's JSDoc: exactly one
   * of `targetStatus`/`targetPhaseId` must be supplied, never inferred.
   */
  onStartLesson?: () => void
  /** Invoked when the primary CTA is "次のフェーズへ進む" (status RUNNING). Same phase-graph-knowledge reasoning as `onStartLesson`. */
  onAdvancePhase?: () => void
  startLessonLabel?: string
  advancePhaseLabel?: string
}

/**
 * The teacher lesson-control screen (Task 11). Wires the three Task 11
 * display components (LessonStatusHeader/ParticipantMonitor/InterventionPanel)
 * to the live Task 8/9/10 client wrappers, and gates every action by role:
 *
 * - A DISABLED-BUT-VISIBLE control (aria-disabled + adjacent reason, see
 *   LessonStatusHeader.tsx) is for an action this role IS authorized to
 *   perform but that is temporarily blocked by lesson state.
 * - A HIDDEN control (never rendered) is for an action this role has no
 *   authority over at all (`canControlLesson`/`canApplyIntervention` false).
 *   The end-lesson danger action and the intervention launcher below both
 *   use this second pattern — an unauthorized teacher must not even be able
 *   to discover the control exists.
 */
export function LessonControlRoom({
  lessonRunId,
  role,
  functions,
  firestore,
  database,
  expectedParticipantCount,
  onStartLesson,
  onAdvancePhase,
  startLessonLabel = '授業を開始',
  advancePhaseLabel = '次のフェーズへ進む',
}: LessonControlRoomProps) {
  const [publicState, setPublicState] = useState<LessonRunPublicState | null>(null)
  const [displayState, setDisplayState] = useState<LessonRunDisplayState | null>(null)
  const [participants, setParticipants] = useState<LessonParticipantView[]>([])
  const [interventionOpen, setInterventionOpen] = useState(false)

  useEffect(() => subscribePublicRun(database, lessonRunId, setPublicState), [database, lessonRunId])
  useEffect(() => subscribeDisplayRun(database, lessonRunId, setDisplayState), [database, lessonRunId])
  useEffect(() => subscribeLessonParticipants(firestore, lessonRunId, setParticipants), [firestore, lessonRunId])

  const status = publicState?.status ?? 'DRAFT'
  const interrupted = status === 'INTERRUPTED'

  const phaseLabel = publicState?.currentPhaseId ?? (status === 'DRAFT' || status === 'READY' ? '未開始' : status)

  const disconnectedCount = participants.filter((p) => DISCONNECTED_STATUSES.has(p.status)).length
  const activeCount = participants.length - disconnectedCount
  const participationSummary = `参加 ${activeCount}人 / 切断 ${disconnectedCount}人`

  const openIssues = useMemo(() => {
    const issues: string[] = []
    if (disconnectedCount > 0) issues.push(`${disconnectedCount}人が切断中です`)
    if (teamSizeImbalance(participants)) issues.push('チーム人数に偏りがあります')
    if (hasDuplicateIdentifiers(participants)) issues.push('重複参加の疑いがあります')
    return issues
  }, [participants, disconnectedCount])

  const displayPreview = displayState
    ? `教室表示: ${DISPLAY_MODE_LABEL[displayState.mode]}${displayState.title ? ` - ${displayState.title}` : ''}`
    : '教室表示: 未接続'

  const nextAction = useMemo(() => {
    if (interrupted) return null
    if ((status === 'DRAFT' || status === 'READY' || status === 'WAITING') && onStartLesson) {
      if (!canControlLesson(role, 'START_LESSON')) return null
      return { label: startLessonLabel, onActivate: onStartLesson }
    }
    if (status === 'RUNNING' && onAdvancePhase) {
      if (!canControlLesson(role, 'TRANSITION_PHASE')) return null
      return { label: advancePhaseLabel, onActivate: onAdvancePhase }
    }
    return null
  }, [interrupted, status, onStartLesson, onAdvancePhase, role, startLessonLabel, advancePhaseLabel])

  const noActionReason = useMemo(() => {
    if (nextAction || interrupted) return undefined
    if (role === 'VIEWER') return '閲覧担当のため、この画面から操作はできません'
    return undefined
  }, [nextAction, interrupted, role])

  const canEndLesson = canControlLesson(role, 'END_LESSON') && (status === 'RUNNING' || status === 'REFLECTION')
  const canHandleConnection = canControlLesson(role, 'HANDLE_CONNECTION')
  const hasAnyIntervention = useMemo(() => {
    const types: LessonInterventionType[] = [
      'EXTEND_TIME', 'PROXY_CONFIRM', 'CHANGE_REPRESENTATIVE', 'RECONNECT_PARTICIPANT',
      'SWITCH_DISPLAY_SLIDE', 'CORRECT_STATE', 'RESTORE_PREVIOUS_PHASE', 'EMERGENCY_STOP', 'HIDE_INFORMATION',
    ]
    return types.some((type) => canApplyIntervention(role, type))
  }, [role])

  const handleResume = useCallback(() => {
    void resumeLesson(functions, { lessonRunId, reason: '教師による再開', idempotencyKey: generateIdempotencyKey() })
  }, [functions, lessonRunId])

  const handleInterrupt = useCallback(() => {
    void interruptLesson(functions, { lessonRunId, reason: '教師による安全停止', idempotencyKey: generateIdempotencyKey() })
  }, [functions, lessonRunId])

  const handleEndLesson = useCallback(() => {
    // completeLessonCallable's client-facing input is just
    // {lessonRunId, reason, idempotencyKey} (see lifecycle.ts's
    // CompleteLessonInput / functions/src/lessonRuns/lifecycle/onCall.ts) —
    // finalResults/checkpointId are derived server-side by
    // completeLessonWithAdminSdk, not supplied by the caller. So this screen
    // has everything it needs to invoke the real "授業を終了" flow (Task 8's
    // 5-stage completeLesson sequence) instead of interruptLesson (中断).
    void completeLesson(functions, { lessonRunId, reason: '教師による授業終了操作', idempotencyKey: generateIdempotencyKey() })
  }, [functions, lessonRunId])

  const handleApplyIntervention = useCallback((input: InterventionApplyInput) => {
    void applyTeacherIntervention(functions, {
      lessonRunId,
      type: input.type,
      reason: input.reason,
      before: null,
      after: null,
      // A per-type impact-scope picker (PARTICIPANT/TEAM) is out of this
      // task's scope — see InterventionPanel.tsx's own comment on generic
      // detail fields. LESSON is the safe default (broadest, matches "whole
      // lesson affected" audit semantics) until a bespoke picker exists.
      impactScope: { level: 'LESSON' },
      detail: input.detail,
      idempotencyKey: generateIdempotencyKey(),
    })
    setInterventionOpen(false)
  }, [functions, lessonRunId])

  return (
    <Stack spacing={3} sx={{ width: '100%', p: 2 }}>
      {interrupted && (
        <Alert
          severity="warning"
          role="alert"
          action={
            canHandleConnection ? (
              <Button color="inherit" size="small" onClick={handleResume} sx={{ minHeight: MIN_TOUCH_TARGET }}>
                授業を再開
              </Button>
            ) : undefined
          }
        >
          授業は安全に停止されています。参加者の接続状況を確認してから再開してください。
        </Alert>
      )}

      <LessonStatusHeader
        phaseLabel={phaseLabel}
        nextAction={nextAction}
        noActionReason={noActionReason}
        participationSummary={participationSummary}
        openIssues={openIssues}
        displayPreview={displayPreview}
      />

      <Box component="section" aria-label="操作">
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {hasAnyIntervention && (
            <Button variant="outlined" onClick={() => setInterventionOpen(true)} sx={{ minHeight: MIN_TOUCH_TARGET }}>
              介入操作を開く
            </Button>
          )}
          {!interrupted && canHandleConnection && (
            <Button variant="outlined" onClick={handleInterrupt} sx={{ minHeight: MIN_TOUCH_TARGET }}>
              授業を安全停止
            </Button>
          )}
          {canEndLesson && (
            <Button variant="outlined" color="error" onClick={handleEndLesson} sx={{ minHeight: MIN_TOUCH_TARGET }}>
              授業を終了
            </Button>
          )}
        </Stack>
      </Box>

      <ParticipantMonitor participants={participants} expectedParticipantCount={expectedParticipantCount} />

      <InterventionPanel
        open={interventionOpen}
        onClose={() => setInterventionOpen(false)}
        role={role}
        onApply={handleApplyIntervention}
      />
    </Stack>
  )
}
