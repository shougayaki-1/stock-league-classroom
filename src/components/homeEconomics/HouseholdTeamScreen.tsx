import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Stack } from '@mui/material'
import type { Database } from 'firebase/database'
import type { Functions } from 'firebase/functions'
import { subscribeOwnTeamState } from '../../lib/lessonRuns/liveRepository'
import { submitHouseholdDecision } from '../../lib/homeEconomics/submitDecision'
import { HouseholdSummaryCard, type HouseholdEventDisclosureView, type HouseholdShortfallOption } from './HouseholdSummaryCard'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

/**
 * Hand-duplicated subset of `HouseholdStateTeamView`
 * (`src/lib/lessonRuns/liveTypes.ts`) — only the fields this screen actually
 * reads. Same functions/src ↔ src hand-sync boundary that type's own JSDoc
 * documents; this is not a new boundary.
 */
interface HouseholdTeamStateNode {
  household?: {
    householdId: string
    cashYen: number
    lifeStage: string
    roundIndex: number
    assetHoldingsYen: Record<string, number>
    visibleConcepts: string[]
    eventDisclosures: HouseholdEventDisclosureView[]
    shortfallOptions: HouseholdShortfallOption[]
  }
}

export interface HouseholdTeamScreenProps {
  lessonRunId: string
  /**
   * This team's own id. Under the COMMON_CONDITIONS scope this fix supports
   * (see `functions/src/homeEconomics/onCall.ts`'s
   * `lazyInitHouseholdWithAdminSdk`), `householdId === teamId` — every
   * submission this screen makes sends `teamId` as the `householdId`.
   */
  teamId: string
  database: Database
  functions: Functions
}

const generateIdempotencyKey = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`

type SubmitStatus = 'IDLE' | 'PENDING' | 'SUCCESS' | 'ERROR'

/**
 * Student-facing container wiring `HouseholdSummaryCard` (the Task 15
 * presentational shell) to live data and the submit Callable — closes the
 * "no student screen exists to drive the flow" half of the final
 * whole-branch review's Critical Fix #1. Subscribes to this team's own
 * `lessonRunTeamState/{lessonRunId}/{teamId}` node via `subscribeOwnTeamState`
 * (liveRepository.ts) and submits decisions via `submitHouseholdDecision`
 * (src/lib/homeEconomics/submitDecision.ts).
 *
 * Not yet wired into `App.tsx`'s routes: the student `/lessons/:runId/play`
 * route still renders `DeferredDataNotice` for every subject, home
 * economics included — see that file's own JSDoc, which notes no
 * wiring container exists yet for ANY subject (Phase C's market side has
 * the identical gap: client wrappers exist, no container renders them).
 * Routing this screen in is a separate, follow-up change — this component
 * itself is what closes the "no student screen" half of Critical Fix #1.
 */
export function HouseholdTeamScreen({ lessonRunId, teamId, database, functions }: HouseholdTeamScreenProps) {
  const [state, setState] = useState<HouseholdTeamStateNode | null>(null)
  const [shortfallResolutionType, setShortfallResolutionType] = useState<string | undefined>(undefined)
  const [shortfallResolutionAssetType, setShortfallResolutionAssetType] = useState<string | undefined>(undefined)
  const [assetAllocationOrder, setAssetAllocationOrder] = useState<string[] | undefined>(undefined)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('IDLE')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(
    () => subscribeOwnTeamState<HouseholdTeamStateNode>(database, lessonRunId, teamId, setState),
    [database, lessonRunId, teamId],
  )

  const household = state?.household

  const handleSubmit = useCallback(() => {
    if (!household) return
    setSubmitStatus('PENDING')
    setErrorMessage(null)
    submitHouseholdDecision(functions, {
      lessonRunId,
      householdId: teamId,
      roundIndex: household.roundIndex,
      assetAllocationChangesYen: {},
      insurancePurchaseIds: [],
      insuranceCancelIds: [],
      shortfallResolutionType: (shortfallResolutionType ?? null) as
        'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL' | null,
      ...(shortfallResolutionType === 'SELL_ASSETS' && shortfallResolutionAssetType
        ? { shortfallResolutionAssetType }
        : {}),
      publicSupportApplicationIds: [],
      idempotencyKey: generateIdempotencyKey(),
    })
      .then(() => setSubmitStatus('SUCCESS'))
      .catch((error: unknown) => {
        setSubmitStatus('ERROR')
        setErrorMessage(error instanceof Error ? error.message : '提出に失敗しました。')
      })
  }, [functions, lessonRunId, teamId, household, shortfallResolutionType, shortfallResolutionAssetType])

  if (!household) return null

  return (
    <Stack spacing={1.5}>
      <HouseholdSummaryCard
        householdId={household.householdId}
        cashYen={household.cashYen}
        lifeStage={household.lifeStage}
        roundIndex={household.roundIndex}
        visibleConcepts={household.visibleConcepts}
        assetHoldingsYen={household.assetHoldingsYen}
        eventDisclosures={household.eventDisclosures}
        shortfallOptions={household.shortfallOptions}
        shortfallResolutionValue={shortfallResolutionType}
        onShortfallResolutionChange={setShortfallResolutionType}
        shortfallResolutionAssetType={shortfallResolutionAssetType}
        onShortfallResolutionAssetTypeChange={setShortfallResolutionAssetType}
        assetAllocationOrder={assetAllocationOrder}
        onAssetAllocationOrderChange={setAssetAllocationOrder}
      />
      <Button
        variant="contained"
        onClick={handleSubmit}
        disabled={submitStatus === 'PENDING'}
        sx={{ minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start' }}
      >
        今回の意思決定を提出する
      </Button>
      {submitStatus === 'SUCCESS' && <Alert severity="success">提出しました。</Alert>}
      {submitStatus === 'ERROR' && <Alert severity="error" role="alert">{errorMessage}</Alert>}
    </Stack>
  )
}
