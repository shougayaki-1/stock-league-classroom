import { useCallback, useState } from 'react'
import { Alert, Button, Stack, Typography } from '@mui/material'
import type { Functions } from 'firebase/functions'
import { processRound } from '../../lib/homeEconomics/processRound'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

export interface HouseholdRoundControlPanelProps {
  lessonRunId: string
  householdId: string
  /** Human-readable heading/aria-label (e.g. `${lifeStage}・${family}`) — falls back to the opaque `householdId` when the caller doesn't have one yet. */
  profileLabel?: string
  functions: Functions
  /** Teacher-facing escape hatch forwarded verbatim to `processRoundCallable` — see that Callable's own doc comment (functions/src/homeEconomics/onCall.ts). */
  forceSettle?: boolean
  onSettled?: () => void
}

type SettleStatus = 'IDLE' | 'PENDING' | 'SUCCESS' | 'ERROR'

/**
 * Minimum viable teacher screen for home economics (final whole-branch
 * review's Critical Fix: Task 15's brief asked for "教師・生徒画面" but only
 * the student card, `HouseholdSummaryCard`, was ever built). Follows
 * `LessonControlRoom.tsx`'s established convention — a thin presentational
 * `Stack` + `Button` wired directly to a Callable via its client wrapper
 * (`src/lib/homeEconomics/processRound.ts`), not a heavier dashboard.
 *
 * Scoped to one household per panel, matching `processRoundCallable`'s own
 * one-household-per-call design — a caller that needs to settle every
 * household in a lessonRun renders one panel per householdId. Enumerating
 * every household in a run has no client wrapper yet (out of this fix's
 * scope — see task-critical-fix-report.md).
 */
export function HouseholdRoundControlPanel({
  lessonRunId, householdId, profileLabel, functions, forceSettle, onSettled,
}: HouseholdRoundControlPanelProps) {
  const displayLabel = profileLabel ?? householdId
  const [status, setStatus] = useState<SettleStatus>('IDLE')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSettle = useCallback(() => {
    setStatus('PENDING')
    setErrorMessage(null)
    processRound(functions, { lessonRunId, householdId, ...(forceSettle !== undefined ? { forceSettle } : {}) })
      .then(() => {
        setStatus('SUCCESS')
        onSettled?.()
      })
      .catch((error: unknown) => {
        setStatus('ERROR')
        setErrorMessage(error instanceof Error ? error.message : '決算に失敗しました。')
      })
  }, [functions, lessonRunId, householdId, forceSettle, onSettled])

  return (
    <Stack spacing={1} sx={{ p: 2 }} component="section" aria-label={`家庭 ${displayLabel} のラウンド決算`}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{displayLabel}</Typography>
      <Button
        variant="contained"
        onClick={handleSettle}
        disabled={status === 'PENDING'}
        sx={{ minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start' }}
      >
        ラウンドを決算する
      </Button>
      {status === 'SUCCESS' && <Alert severity="success">決算が完了しました。</Alert>}
      {status === 'ERROR' && <Alert severity="error" role="alert">{errorMessage}</Alert>}
    </Stack>
  )
}
