import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from 'firebase/database'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock pattern as LessonControlRoom.test.tsx: real
// client wrappers (subscribeOwnTeamState / subscribePublicRun /
// submitHouseholdDecision) run against faked Firebase SDK calls, so this
// exercises the actual wiring. The component under test is imported
// dynamically AFTER these vi.mock calls (not statically at the top) for the
// same hoisting reason LessonControlRoom.test.tsx documents at its own
// dynamic import site.
//
// Two RTDB nodes are subscribed by this screen (own team state AND
// lessonRunPublic, for the automatic-comparison switch), so listeners are
// captured per-path — a single shared variable (the previous version of
// this mock) would have the second subscription silently clobber the
// first.
const refMock = vi.fn((_database: unknown, path: string) => ({ __path: path }))
let teamStateListener: ((snapshot: { val: () => unknown }) => void) | undefined
let publicRunListener: ((snapshot: { val: () => unknown }) => void) | undefined
const onValueMock = vi.fn((nodeRef: { __path: string }, onNext: (s: { val: () => unknown }) => void) => {
  if (nodeRef.__path.startsWith('lessonRunTeamState/')) teamStateListener = onNext
  if (nodeRef.__path.startsWith('lessonRunPublic/')) publicRunListener = onNext
  return () => {}
})
vi.mock('firebase/database', () => ({ ref: refMock, onValue: onValueMock, off: vi.fn() }))

const callableMock = vi.fn().mockResolvedValue({ data: { decisionId: 'dec-1', created: true } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callableMock) }))

const { HouseholdTeamScreen } = await import('./HouseholdTeamScreen')

function emitTeamState(value: unknown) {
  act(() => { teamStateListener?.({ val: () => value }) })
}

function emitPublicRun(value: unknown) {
  act(() => { publicRunListener?.({ val: () => value }) })
}

const household = {
  householdId: 'team-a', cashYen: 500000, lifeStage: 'CHILD_REARING', roundIndex: 0,
  assetHoldingsYen: { DOMESTIC_STOCK: 100000 }, visibleConcepts: [], eventDisclosures: [], shortfallOptions: [],
}

function renderScreen(teamId = 'team-a') {
  return render(<HouseholdTeamScreen lessonRunId="run-1" teamId={teamId} database={{} as Database} functions={{} as Functions} />)
}

describe('HouseholdTeamScreen — ROLE/STAGE (Common and single-household advanced, one case)', () => {
  it('renders nothing until the team state has loaded', () => {
    renderScreen()
    expect(screen.queryByText('team-a')).not.toBeInTheDocument()
  })

  it('renders the household once lessonRunTeamState/{runId}/{teamId} resolves (Common .household shape), and submits via the real Callable wrapper with householdId === teamId', async () => {
    const user = userEvent.setup()
    renderScreen()

    emitTeamState({ household })

    expect(screen.getByText('team-a')).toBeInTheDocument()
    expect(refMock).toHaveBeenCalledWith({}, 'lessonRunTeamState/run-1/team-a')

    await user.click(screen.getByRole('button', { name: '今回の意思決定を提出する' }))

    expect(callableMock).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', householdId: 'team-a', roundIndex: 0, shortfallResolutionType: null,
    }))
    expect(await screen.findByText('提出しました。')).toBeInTheDocument()
  })

  it('renders a single-entry advanced .households shape (ROLE_VARIANT/STAGE_SPLIT) functionally identically — no tabs — reading through households[householdOrder[0]]', async () => {
    const user = userEvent.setup()
    renderScreen()

    emitTeamState({
      courseFormat: 'ROLE_VARIANT',
      synchronizedRoundIndex: 0,
      roundStatus: 'OPEN',
      householdOrder: ['case-alpha'],
      households: { 'case-alpha': { householdId: 'case-alpha', state: { ...household, householdId: 'case-alpha' } } },
    })

    expect(screen.getByText('case-alpha')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '今回の意思決定を提出する' }))
    expect(callableMock).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'case-alpha' }))
  })
})

describe('HouseholdTeamScreen — MULTI (multiple households per team)', () => {
  const multiState = {
    courseFormat: 'MULTI_PERSON_PER_TEAM',
    synchronizedRoundIndex: 0,
    roundStatus: 'OPEN',
    householdOrder: ['case-b', 'case-a', 'case-c'],
    households: {
      'case-a': {
        householdId: 'case-a',
        profile: { lifeStage: 'SINGLE', family: '独身' },
        state: { ...household, householdId: 'case-a', lifeStage: 'SINGLE' },
      },
      'case-b': {
        householdId: 'case-b',
        profile: { lifeStage: 'CHILD_REARING', family: '配偶者・子1人' },
        state: { ...household, householdId: 'case-b', lifeStage: 'CHILD_REARING' },
      },
      'case-c': {
        householdId: 'case-c',
        profile: { lifeStage: 'RETIRED', family: '配偶者のみ' },
        state: { ...household, householdId: 'case-c', lifeStage: 'RETIRED' },
      },
    },
  }

  /**
   * Important I3 (whole-branch review): a MULTI team's tabs previously
   * labeled themselves with `state.householdId` — an opaque
   * `idempotencyDocumentId()` runtime hash, meaningless to a student. This
   * proves the tab label is now human-readable (`lifeStage`・`family`,
   * read from `.profile` — Task 9's projection already publishes it, but
   * this screen never read it before this fix).
   */
  it('labels each tab with a human-readable lifeStage・family pair from .profile, not the opaque runtime householdId (Important I3)', () => {
    renderScreen()
    emitTeamState(multiState)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'CHILD_REARING・配偶者・子1人',
      'SINGLE・独身',
      'RETIRED・配偶者のみ',
    ])
    // None of the runtime householdId hashes leak into a tab label.
    expect(screen.queryByRole('tab', { name: 'case-a' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'case-b' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'case-c' })).not.toBeInTheDocument()
  })

  /**
   * Important I3: MULTI_PERSON_PER_TEAM puts EVERY authored profile on the
   * same team (unlike STAGE_SPLIT, which guarantees distinct stages), so an
   * authoring template with two profiles sharing a `lifeStage` is possible.
   * `lifeStage` alone would then produce two identical tab labels — pairing
   * it with `family` (always, not only on a detected collision) resolves
   * this without needing collision-detection logic.
   */
  it('disambiguates two households sharing the same lifeStage via family (Important I3)', () => {
    renderScreen()
    emitTeamState({
      ...multiState,
      householdOrder: ['case-a', 'case-d'],
      households: {
        'case-a': multiState.households['case-a'],
        'case-d': {
          householdId: 'case-d',
          profile: { lifeStage: 'SINGLE', family: '同棲中のパートナーあり' },
          state: { ...household, householdId: 'case-d', lifeStage: 'SINGLE' },
        },
      },
    })

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'SINGLE・独身',
      'SINGLE・同棲中のパートナーあり',
    ])
    expect(new Set(tabs.map((tab) => tab.textContent)).size).toBe(2)
  })

  it('renders stable tabs in householdOrder order, not object-key order, and keeps that order stable across a re-render/update', () => {
    renderScreen()
    emitTeamState(multiState)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'CHILD_REARING・配偶者・子1人',
      'SINGLE・独身',
      'RETIRED・配偶者のみ',
    ])

    // A subsequent update (e.g. cashYen changing this round) must not
    // reorder the tabs — order is driven by householdOrder, not by
    // recomputing anything from the (unordered) households map.
    emitTeamState({
      ...multiState,
      households: {
        ...multiState.households,
        'case-a': { ...multiState.households['case-a'], state: { ...multiState.households['case-a'].state, cashYen: 999999 } },
      },
    })
    const tabsAfter = screen.getAllByRole('tab')
    expect(tabsAfter.map((tab) => tab.textContent)).toEqual([
      'CHILD_REARING・配偶者・子1人',
      'SINGLE・独身',
      'RETIRED・配偶者のみ',
    ])
  })

  it('selecting a tab switches which household is shown, and the selected RUNTIME householdId (not teamId) is sent to the decision API on submit', async () => {
    const user = userEvent.setup()
    renderScreen('team-x')
    emitTeamState(multiState)

    // First tab (case-b) selected by default.
    expect(screen.getByText('ライフステージ: CHILD_REARING')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'SINGLE・独身' }))
    expect(screen.getByText('ライフステージ: SINGLE')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '今回の意思決定を提出する' }))
    expect(callableMock).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'case-a', lessonRunId: 'run-1' }))
    expect(callableMock).not.toHaveBeenCalledWith(expect.objectContaining({ householdId: 'team-x' }))
  })

  it('all team households are visible (no sub-team partitioning) — every entry in householdOrder has a corresponding tab', () => {
    renderScreen()
    emitTeamState(multiState)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'SINGLE・独身' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'CHILD_REARING・配偶者・子1人' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'RETIRED・配偶者のみ' })).toBeInTheDocument()
  })

  it('SETTLING: submission is disabled/hidden, mirroring the server-side OPEN-only guard', async () => {
    renderScreen()
    emitTeamState({ ...multiState, roundStatus: 'SETTLING' })

    expect(screen.queryByRole('button', { name: '今回の意思決定を提出する' })).not.toBeInTheDocument()
    expect(screen.getByText(/決算処理中/)).toBeInTheDocument()
  })
})

describe('HouseholdTeamScreen — automatic class comparison (REFLECTION)', () => {
  it('once lessonRunPublic.householdClassComparison is present, the comparison becomes the PRIMARY view — no publish/reveal action, replacing the household-editing UI', () => {
    renderScreen()
    emitTeamState({
      courseFormat: 'ROLE_VARIANT', synchronizedRoundIndex: 3, roundStatus: 'OPEN',
      householdOrder: ['case-a'], households: { 'case-a': { householdId: 'case-a', state: { ...household, householdId: 'case-a' } } },
    })
    expect(screen.getByText('case-a')).toBeInTheDocument()

    emitPublicRun({
      status: 'REFLECTION',
      householdClassComparison: {
        courseFormat: 'ROLE_VARIANT',
        finalRoundCount: 4,
        publishedAtMillis: 1000,
        teams: [{ teamDisplayName: 'チームA', households: [] }],
      },
    })

    expect(screen.getByText('クラス全体の比較')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '今回の意思決定を提出する' })).not.toBeInTheDocument()
    expect(screen.queryByText('case-a')).not.toBeInTheDocument()
  })
})
