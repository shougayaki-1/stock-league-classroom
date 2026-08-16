import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Stack, Tab, Tabs } from '@mui/material'
import type { Database } from 'firebase/database'
import type { Functions } from 'firebase/functions'
import { subscribeOwnTeamState, subscribePublicRun } from '../../lib/lessonRuns/liveRepository'
import { submitHouseholdDecision } from '../../lib/homeEconomics/submitDecision'
import { HouseholdSummaryCard, type HouseholdEventDisclosureView, type HouseholdShortfallOption } from './HouseholdSummaryCard'
import { HouseholdClassComparisonView } from './HouseholdClassComparisonView'
import type { HouseholdClassComparisonPublicView } from '../../lib/lessonRuns/liveTypes'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

/**
 * Hand-duplicated subset of `HouseholdStateTeamView`
 * (`src/lib/lessonRuns/liveTypes.ts`) — only the fields this screen actually
 * reads. Same functions/src ↔ src hand-sync boundary that type's own JSDoc
 * documents; this is not a new boundary. Shared by BOTH the Common
 * `.household` shape and each entry's `.state` under the advanced
 * `.households` map below — one household's renderable fields are identical
 * regardless of which course format produced them.
 */
interface HouseholdEntryStateNode {
  householdId: string
  cashYen: number
  lifeStage: string
  roundIndex: number
  assetHoldingsYen: Record<string, number>
  visibleConcepts: string[]
  eventDisclosures: HouseholdEventDisclosureView[]
  shortfallOptions: HouseholdShortfallOption[]
}

/**
 * Hand-duplicated subset of `AdvancedHouseholdTeamEntryView`
 * (`src/lib/lessonRuns/liveTypes.ts`). Task 9's RTDB projection already
 * publishes `.profile` (a `HouseholdProfilePublicView`) into this same
 * entry specifically so a UI could label a household by something more
 * meaningful than its opaque runtime `householdId` — see this screen's tab
 * rendering below (Important I3 fix), which reads `lifeStage`/`family` from
 * it. Only those two fields are duplicated here (not the full
 * `HouseholdProfilePublicView`), since this screen doesn't need the rest.
 */
interface AdvancedHouseholdEntryNode {
  householdId: string
  profile: { lifeStage: string; family: string }
  state: HouseholdEntryStateNode
}

/**
 * Task 13: generalized over BOTH shapes `lessonRunTeamState/{lessonRunId}/
 * {teamId}` can take (see `LessonRunTeamState`'s own JSDoc,
 * `src/lib/lessonRuns/liveTypes.ts`):
 *
 * - Common (COMMON_CONDITIONS): a single `.household` field,
 *   `householdId === teamId`.
 * - Advanced (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM, Task 9): a
 *   `.households` map (keyed by RUNTIME householdId, which is NEVER
 *   `teamId`) plus `.householdOrder` (stable display order) and
 *   `.roundStatus` ('OPEN' | 'SETTLING' — mirrors Task 5's server-side
 *   OPEN-only submission guard for this screen's read-only UX).
 *
 * A node never carries both — a lessonRun's courseFormat never changes
 * after creation (see `LessonRunTeamState`'s own JSDoc).
 */
interface HouseholdTeamStateNode {
  household?: HouseholdEntryStateNode
  households?: Record<string, AdvancedHouseholdEntryNode>
  householdOrder?: string[]
  roundStatus?: 'OPEN' | 'SETTLING'
}

export interface HouseholdTeamScreenProps {
  lessonRunId: string
  /**
   * This team's own id. Under the COMMON_CONDITIONS scope (see
   * `functions/src/homeEconomics/onCall.ts`'s `lazyInitHouseholdWithAdminSdk`),
   * `householdId === teamId` — the Common submission path still sends
   * `teamId` as the `householdId`. Under an advanced course format, the
   * submitted `householdId` is instead whichever entry of `.households` the
   * student currently has selected (see `activeHouseholdId` below) — never
   * `teamId`, which is not a valid runtime householdId for those formats.
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
 * (src/lib/homeEconomics/submitDecision.ts) — that client wrapper's request
 * shape is already identical for Common and every advanced course format
 * (`submitHouseholdDecisionCallable` resolves `assignmentRevision` itself,
 * server-side, from `HouseholdRuntimeControl`; see that Callable's own
 * dispatch logic), so no signature change was needed there for Task 13.
 *
 * Task 13 also makes the class comparison the PRIMARY view, automatically,
 * once one exists: `lessonRunPublic/{lessonRunId}`'s `householdClassComparison`
 * field (Task 12's `afterReflectionTransition`) is subscribed alongside the
 * team state, and — the instant it is present — this screen renders
 * `HouseholdClassComparisonView` instead of the household-editing UI. No
 * publish/reveal action exists or is needed: by the time that field is
 * present, the lesson has already left RUNNING, so there is nothing left for
 * a student to decide.
 *
 * Wired into `App.tsx`'s `/play` route (Task 13) — see that file's own
 * household-mode-detection comment for how it decides whether to render this
 * screen at all (shape-based, from the very node this screen itself
 * subscribes to).
 */
export function HouseholdTeamScreen({ lessonRunId, teamId, database, functions }: HouseholdTeamScreenProps) {
  const [state, setState] = useState<HouseholdTeamStateNode | null>(null)
  const [comparison, setComparison] = useState<HouseholdClassComparisonPublicView | null>(null)
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null)
  const [shortfallResolutionType, setShortfallResolutionType] = useState<string | undefined>(undefined)
  const [shortfallResolutionAssetType, setShortfallResolutionAssetType] = useState<string | undefined>(undefined)
  const [assetAllocationOrder, setAssetAllocationOrder] = useState<string[] | undefined>(undefined)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('IDLE')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(
    () => subscribeOwnTeamState<HouseholdTeamStateNode>(database, lessonRunId, teamId, setState),
    [database, lessonRunId, teamId],
  )

  useEffect(
    () => subscribePublicRun(database, lessonRunId, (publicState) => setComparison(publicState?.householdClassComparison ?? null)),
    [database, lessonRunId],
  )

  // Stable order, driven entirely by the server-published `householdOrder`
  // array (never `Object.keys(state.households)`, whose enumeration order is
  // not a contract) — this is what keeps every team member's tab order
  // identical, and identical across re-renders/updates, even as individual
  // households' own fields (cashYen, etc.) change underneath.
  const householdOrder = state?.householdOrder ?? []
  const isAdvanced = state?.households !== undefined && householdOrder.length > 0

  const activeHouseholdId = isAdvanced
    ? (selectedHouseholdId !== null && householdOrder.includes(selectedHouseholdId) ? selectedHouseholdId : householdOrder[0])
    : teamId

  const household: HouseholdEntryStateNode | undefined = isAdvanced
    ? state?.households?.[activeHouseholdId]?.state
    : state?.household

  // Decision-draft fields are per-household — switching the selected tab
  // must not leak one household's in-progress shortfall/allocation choice
  // into another's submission.
  useEffect(() => {
    setShortfallResolutionType(undefined)
    setShortfallResolutionAssetType(undefined)
    setAssetAllocationOrder(undefined)
    setSubmitStatus('IDLE')
    setErrorMessage(null)
  }, [activeHouseholdId])

  const isSettling = state?.roundStatus === 'SETTLING'

  // Important I3 fix: label each tab with something a student can actually
  // read, instead of the opaque runtime `householdId` (an
  // `idempotencyDocumentId()` hash — Task 1 — meaningless to a student).
  // `lifeStage` alone is not guaranteed unique within a team:
  // MULTI_PERSON_PER_TEAM puts EVERY authored profile on the same team (not
  // just distinct stages the way STAGE_SPLIT does), so an authoring template
  // with two profiles sharing a `lifeStage` would otherwise still produce
  // two identical tab labels. Always pairing `lifeStage` with `family`
  // (rather than only falling back to it when a collision is detected)
  // keeps this simple and robust against that case without needing to
  // detect collisions at render time — every household's `family` text is
  // authored freely per profile, so the pair is unique in practice. Neither
  // field is translated to a Japanese label here: the rest of this app
  // (`HouseholdSummaryCard`, `HouseholdClassComparisonView`) also renders
  // `lifeStage`'s raw enum string with no existing translation convention
  // to match, so this keeps the SAME convention rather than introducing a
  // one-off mapping found nowhere else.
  const householdTabLabel = (id: string): string => {
    const entry = state?.households?.[id]
    if (!entry) return id
    return `${entry.profile.lifeStage}・${entry.profile.family}`
  }

  const handleSubmit = useCallback(() => {
    if (!household || isSettling) return
    setSubmitStatus('PENDING')
    setErrorMessage(null)
    submitHouseholdDecision(functions, {
      lessonRunId,
      householdId: activeHouseholdId,
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
  }, [functions, lessonRunId, activeHouseholdId, household, isSettling, shortfallResolutionType, shortfallResolutionAssetType])

  // Task 13: once the class-wide comparison exists, it IS the screen — a
  // student can no longer submit anything meaningful (the lesson has left
  // RUNNING), so this takes priority over every household-editing branch
  // below, automatically (no publish/reveal action).
  if (comparison) return <HouseholdClassComparisonView comparison={comparison} />

  if (!household) return null

  return (
    <Stack spacing={1.5}>
      {isAdvanced && householdOrder.length > 1 && (
        <Tabs
          value={activeHouseholdId}
          onChange={(_event, value: string) => setSelectedHouseholdId(value)}
          aria-label="担当する家庭"
          variant="scrollable"
        >
          {householdOrder.map((id) => (
            <Tab key={id} value={id} label={householdTabLabel(id)} />
          ))}
        </Tabs>
      )}
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
      {isSettling ? (
        <Alert severity="info">この家庭は現在決算処理中のため、提出できません。次のラウンドが始まるまでお待ちください。</Alert>
      ) : (
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitStatus === 'PENDING'}
          sx={{ minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start' }}
        >
          今回の意思決定を提出する
        </Button>
      )}
      {submitStatus === 'SUCCESS' && <Alert severity="success">提出しました。</Alert>}
      {submitStatus === 'ERROR' && <Alert severity="error" role="alert">{errorMessage}</Alert>}
    </Stack>
  )
}
