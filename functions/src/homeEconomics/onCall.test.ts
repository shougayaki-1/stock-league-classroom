import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  processRoundCallable,
  restoreHouseholdCheckpointCallable,
  submitHouseholdDecisionCallable,
  writeHouseholdCheckpointCallable,
} from './onCall'
import {
  getHouseholdStateWithAdminSdk,
  getOrInitHouseholdState,
  householdRepositoryWithAdminSdk,
  saveHouseholdDecision,
} from '../lessonRuns/households/repository'
import { requireActiveOrgMember } from '../organizations/authorization'
import { restoreCheckpointWithAdminSdk, writeCheckpointWithAdminSdk } from '../lessonRuns/checkpoint'
import { processRoundWithAdminSdk } from './processRound'

const participantGetMock = vi.fn()
const teamGetMock = vi.fn()
const lessonRunGetMock = vi.fn()
const checkpointGetMock = vi.fn()
const teamDocPaths: string[] = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (/^lessonRuns\/[^/]+$/.test(path)) return { get: lessonRunGetMock }
      if (path.includes('/checkpoints/')) return { get: checkpointGetMock }
      if (!path.includes('/participantsByAuthUid/')) teamDocPaths.push(path)
      return { get: path.includes('/participantsByAuthUid/') ? participantGetMock : teamGetMock }
    },
  }),
}))

vi.mock('../lessonRuns/households/repository', () => ({
  getHouseholdStateWithAdminSdk: vi.fn(),
  getOrInitHouseholdState: vi.fn(),
  householdRepositoryWithAdminSdk: vi.fn(() => ({})),
  saveHouseholdDecision: vi.fn(),
}))

vi.mock('../lessonRuns/checkpoint', () => ({
  writeCheckpointWithAdminSdk: vi.fn(),
  restoreCheckpointWithAdminSdk: vi.fn(),
}))

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./processRound', () => ({ processRoundWithAdminSdk: vi.fn() }))

interface SubmitHouseholdDecisionRequestData {
  lessonRunId: string
  householdId: string
  roundIndex: number
  assetAllocationChangesYen: Record<string, number>
  insurancePurchaseIds: string[]
  insuranceCancelIds: string[]
  shortfallResolutionType: 'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL' | null
  shortfallResolutionAssetType?: string
  publicSupportApplicationIds: string[]
  idempotencyKey: string
  voluntaryDrawdownRequestedYen?: number
}

const makeRequest = (
  data: Partial<SubmitHouseholdDecisionRequestData> = {}, uid = 'student-a',
): CallableRequest<SubmitHouseholdDecisionRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'anonymous' } } },
  data: {
    lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
    assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
    shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
    ...data,
  },
  rawRequest: {},
} as unknown as CallableRequest<SubmitHouseholdDecisionRequestData>)

const household = {
  householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', cashYen: 500000,
  assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
  lifeStage: 'INDEPENDENT', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
}

const makeLessonRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

describe('submitHouseholdDecisionCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    teamDocPaths.length = 0
    participantGetMock.mockResolvedValue({ exists: true, data: () => ({ participantId: 'p-1' }) })
    teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['p-1'] }) })
    vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(household)
    // Important I2: `requireLessonRunRunning` now reads the LessonRun doc on
    // every call — default it to RUNNING so every pre-existing test (which
    // predates I2 and doesn't set this up itself) keeps exercising its own
    // intended path rather than tripping the new status gate.
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { status: 'RUNNING' }))
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<SubmitHouseholdDecisionRequestData>
    await expect(submitHouseholdDecisionCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(getHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['householdId', { householdId: '' }],
    ['roundIndex', { roundIndex: -1 }],
    ['idempotencyKey', { idempotencyKey: '' }],
    ['shortfallResolutionType', { shortfallResolutionType: 'BOGUS' as never }],
    // #1: SELL_ASSETS without naming which asset must not silently skip the
    // §13.13 consistency check.
    ['shortfallResolutionType SELL_ASSETS missing shortfallResolutionAssetType', { shortfallResolutionType: 'SELL_ASSETS' as const }],
    // #3: assetAllocationChangesYen must be a plain finite-number map, not
    // an array and not containing non-numeric values.
    ['assetAllocationChangesYen as an array', { assetAllocationChangesYen: [100000] as unknown as Record<string, number> }],
    ['assetAllocationChangesYen with a non-numeric value', { assetAllocationChangesYen: { DOMESTIC_STOCK: '100000' } as unknown as Record<string, number> }],
    ['assetAllocationChangesYen with a non-finite value', { assetAllocationChangesYen: { DOMESTIC_STOCK: Infinity } }],
    // #3: string-array fields must contain non-empty strings, not arbitrary
    // elements.
    ['insurancePurchaseIds with a non-string element', { insurancePurchaseIds: [123 as unknown as string] }],
    ['insuranceCancelIds with an empty-string element', { insuranceCancelIds: [''] }],
    ['publicSupportApplicationIds with a non-string element', { publicSupportApplicationIds: [null as unknown as string] }],
    // Task 11/12 integration gap fix: voluntaryDrawdownRequestedYen must be
    // a non-negative finite number when present — this money-conservation-
    // critical field must never carry a negative/NaN/Infinity value into
    // settleRound's drawdown math.
    ['voluntaryDrawdownRequestedYen negative', { voluntaryDrawdownRequestedYen: -1 }],
    ['voluntaryDrawdownRequestedYen non-finite', { voluntaryDrawdownRequestedYen: Infinity }],
    ['voluntaryDrawdownRequestedYen NaN', { voluntaryDrawdownRequestedYen: NaN }],
    // Review finding (Important #1): a fractional request would otherwise
    // flow into `computeVoluntaryAssetDrawdown`'s whole-yen-per-step
    // remainder math and silently destroy the fractional part of a yen.
    ['voluntaryDrawdownRequestedYen fractional', { voluntaryDrawdownRequestedYen: 100.5 }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(submitHouseholdDecisionCallable.run(makeRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(getHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
  })

  // Critical Fix #1 (final whole-branch review): a missing household no
  // longer means an unconditional 'not-found' — it triggers lazy-init
  // (`lazyInitHouseholdWithAdminSdk`). These tests replace the old
  // unconditional-'not-found' expectation with the lazy-init decision tree.
  describe('lazy household initialization (Critical Fix #1)', () => {
    const homeEconomicsContent = {
      households: [{
        householdId: 'template-profile-1', age: 32, householdIncomeYen: 6000000,
        annualLivingExpensesYen: 3000000, cashSavingsYen: 500000, family: '配偶者・子2人',
        housing: '賃貸マンション', lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
        eventProbabilityOverrides: {}, internalRiskFactors: {},
      }],
      courseFormat: 'COMMON_CONDITIONS',
    }

    it('rejects with not-found when the household is missing AND the LessonRun itself does not exist', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(false))
      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'not-found' })
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
      expect(getOrInitHouseholdState).not.toHaveBeenCalled()
    })

    it('rejects with permission-denied when the caller is not a member of the team named by householdId, without creating a household', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['someone-else'] }) })
      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
      expect(getOrInitHouseholdState).not.toHaveBeenCalled()
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
    })

    it('rejects with failed-precondition when the template is not COMMON_CONDITIONS / has more than one profile', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
        templateSnapshot: { homeEconomics: { ...homeEconomicsContent, courseFormat: 'ROLE_VARIANT' } },
      }))
      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
      expect(getOrInitHouseholdState).not.toHaveBeenCalled()
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
    })

    it('lazily creates the household from the template\'s sole profile, keyed by householdId===teamId, then proceeds to save the decision', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { status: 'RUNNING', templateSnapshot: { homeEconomics: homeEconomicsContent } }))
      const initializedHousehold = {
        householdId: 'case-b', lessonRunId: 'run-1', teamId: 'case-b', cashYen: 500000,
        assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
        lifeStage: 'CHILD_REARING', roundIndex: 0, goalDelayedRounds: 0, updatedAtServerMillis: 0,
      }
      vi.mocked(getOrInitHouseholdState).mockResolvedValue(initializedHousehold)
      vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-new', created: true })

      await expect(submitHouseholdDecisionCallable.run(makeRequest({ roundIndex: 0 })))
        .resolves.toEqual({ decisionId: 'dec-new', created: true })

      expect(getOrInitHouseholdState).toHaveBeenCalledWith(expect.objectContaining({
        lessonRunId: 'run-1', teamId: 'case-b', householdId: 'case-b',
        startingCashYen: 500000, startingLifeStage: 'CHILD_REARING',
      }))
      expect(saveHouseholdDecision).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1', householdId: 'case-b' }))
    })
  })

  it('rejects a caller who is not a member of the team that owns this household (never trusting a client-supplied teamId)', async () => {
    teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['someone-else'] }) })
    await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(saveHouseholdDecision).not.toHaveBeenCalled()
  })

  it('resolves team ownership from the household\'s own stored teamId, not from client input', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    await submitHouseholdDecisionCallable.run(makeRequest())
    // team-a is the household's OWN teamId (never sent by the client at all —
    // the request payload for this Callable has no `teamId` field). Asserting
    // on the captured `doc(...)` path (not just that `get()` was called at
    // all) proves the correct team document was read.
    expect(teamGetMock).toHaveBeenCalled()
    expect(teamDocPaths).toHaveLength(1)
    expect(teamDocPaths[0]).toMatch(/\/teams\/team-a$/)
  })

  it('is idempotent: a repeated idempotencyKey is forwarded through unchanged and the reported created flag reflects saveDecision\'s own dedup result', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValueOnce({ decisionId: 'dec-1', created: true })
    const first = await submitHouseholdDecisionCallable.run(makeRequest())
    expect(first).toEqual({ decisionId: 'dec-1', created: true })

    vi.mocked(saveHouseholdDecision).mockResolvedValueOnce({ decisionId: 'dec-1', created: false })
    const second = await submitHouseholdDecisionCallable.run(makeRequest())
    expect(second).toEqual({ decisionId: 'dec-1', created: false })

    expect(vi.mocked(saveHouseholdDecision).mock.calls[0][0]).toMatchObject({ idempotencyKey: 'key-1', roundIndex: 3 })
    expect(vi.mocked(saveHouseholdDecision).mock.calls[1][0]).toMatchObject({ idempotencyKey: 'key-1', roundIndex: 3 })
  })

  it('happy path: forwards a valid decision and returns the saved decisionId/created', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-42', created: true })
    await expect(submitHouseholdDecisionCallable.run(makeRequest())).resolves.toEqual({ decisionId: 'dec-42', created: true })
    expect(saveHouseholdDecision).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, idempotencyKey: 'key-1',
    }))
  })

  it('translates the internal-consistency rejection (spec §13.13) into failed-precondition', async () => {
    await expect(submitHouseholdDecisionCallable.run(makeRequest({
      shortfallResolutionType: 'SELL_ASSETS', shortfallResolutionAssetType: 'DOMESTIC_STOCK',
      assetAllocationChangesYen: { DOMESTIC_STOCK: 50000 },
    }))).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(saveHouseholdDecision).not.toHaveBeenCalled()
  })

  it('translates an idempotency key payload mismatch into failed-precondition', async () => {
    vi.mocked(saveHouseholdDecision).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    await expect(submitHouseholdDecisionCallable.run(makeRequest()))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })

  it('accepts a request that omits shortfallResolutionType entirely, normalizing it to null rather than crashing (#2)', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    const { shortfallResolutionType: _omit, ...dataWithoutShortfallType } = makeRequest().data
    const request = { ...makeRequest(), data: dataWithoutShortfallType } as unknown as CallableRequest<SubmitHouseholdDecisionRequestData>
    await expect(submitHouseholdDecisionCallable.run(request)).resolves.toEqual({ decisionId: 'dec-1', created: true })
    expect(saveHouseholdDecision).toHaveBeenCalledWith(expect.objectContaining({ shortfallResolutionType: null }))
  })

  it('rejects a request whose roundIndex does not match the household\'s own stored roundIndex (#4)', async () => {
    await expect(submitHouseholdDecisionCallable.run(makeRequest({ roundIndex: household.roundIndex + 1 })))
      .rejects.toMatchObject({ code: 'failed-precondition' })
    expect(saveHouseholdDecision).not.toHaveBeenCalled()
  })

  it('forwards voluntaryDrawdownRequestedYen through to saveDecision when present (Task 11/12 integration gap fix)', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    await submitHouseholdDecisionCallable.run(makeRequest({ voluntaryDrawdownRequestedYen: 300000 }))
    expect(saveHouseholdDecision).toHaveBeenCalledWith(expect.objectContaining({ voluntaryDrawdownRequestedYen: 300000 }))
  })

  it('omits voluntaryDrawdownRequestedYen from saveDecision when not provided, rather than forwarding undefined', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    await submitHouseholdDecisionCallable.run(makeRequest())
    const call = vi.mocked(saveHouseholdDecision).mock.calls[0][0]
    expect('voluntaryDrawdownRequestedYen' in call).toBe(false)
  })

  /**
   * Important I2 (final whole-branch review): a lesson that is
   * COMPLETED/ABORTED/INTERRUPTED/etc. must reject a decision submission —
   * previously this Callable never checked `LessonRun.status` at all.
   * Mirrors `market/onCall.ts`'s `isMarketAcceptingOrdersWithAdminSdk`
   * precedent (status !== 'RUNNING' → rejected).
   */
  describe('lesson-status gate (Important I2)', () => {
    it.each(['COMPLETED', 'ABORTED', 'INTERRUPTED', 'WAITING', 'PAUSED'])(
      'rejects with failed-precondition when the LessonRun status is %s, without saving a decision',
      async (status) => {
        lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { status }))
        await expect(submitHouseholdDecisionCallable.run(makeRequest()))
          .rejects.toMatchObject({ code: 'failed-precondition' })
        expect(saveHouseholdDecision).not.toHaveBeenCalled()
      },
    )

    it('rejects with failed-precondition when the LessonRun has no status field at all', async () => {
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {}))
      await expect(submitHouseholdDecisionCallable.run(makeRequest()))
        .rejects.toMatchObject({ code: 'failed-precondition' })
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
    })

    it('rejects even for an existing (non-lazy-init) household, before authorization-adjacent state is touched', async () => {
      // household already exists (default beforeEach mock) — this is NOT
      // the lazy-init path; the gate must still apply.
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { status: 'COMPLETED' }))
      await expect(submitHouseholdDecisionCallable.run(makeRequest()))
        .rejects.toMatchObject({ code: 'failed-precondition' })
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
    })

    it('proceeds normally when status is RUNNING (regression guard)', async () => {
      vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { status: 'RUNNING' }))
      await expect(submitHouseholdDecisionCallable.run(makeRequest())).resolves.toEqual({ decisionId: 'dec-1', created: true })
    })
  })
})

interface ProcessRoundRequestData {
  lessonRunId: string
  householdId: string
  forceSettle?: boolean
}

const makeProcessRoundRequest = (
  data: Partial<ProcessRoundRequestData> = {}, uid = 'teacher-a',
): CallableRequest<ProcessRoundRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: { lessonRunId: 'run-1', householdId: 'case-b', ...data },
  rawRequest: {},
} as unknown as CallableRequest<ProcessRoundRequestData>)

describe('processRoundCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<ProcessRoundRequestData>
    await expect(processRoundCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['householdId', { householdId: '' }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(processRoundCallable.run(makeProcessRoundRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('rejects when the LessonRun does not exist', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(false))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ASSISTANT-role teacher (PROCESS_ROUND is PRIMARY-only, never trusting a client-asserted role)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (PROCESS_ROUND is PRIMARY-only)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds for a PRIMARY-role teacher who is an active org member (happy path)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', status: 'RUNNING', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const result = {
      newHouseholdState: { householdId: 'case-b' }, occurredEventIds: [], incomeYen: 0, expensesYen: 0,
      netCashFlowYen: 0, shortfallYen: 0, insuranceBenefitsYen: 0,
    }
    vi.mocked(processRoundWithAdminSdk).mockResolvedValue(result as never)

    await expect(processRoundCallable.run(makeProcessRoundRequest())).resolves.toEqual(result)

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-1', 'teacher-a')
    expect(processRoundWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: false,
    })
  })

  it('translates "HouseholdState not found" into not-found', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', status: 'RUNNING', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(processRoundWithAdminSdk).mockRejectedValue(new Error('HouseholdState not found'))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'not-found' })
  })

  // Task 11 review round 2 — brief §Step 6 submission gate.
  it('rejects a non-boolean forceSettle', async () => {
    await expect(processRoundCallable.run(makeProcessRoundRequest({ forceSettle: 'yes' as unknown as boolean })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('translates "HouseholdDecision not submitted for this round" into failed-precondition', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', status: 'RUNNING', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(processRoundWithAdminSdk).mockRejectedValue(new Error('HouseholdDecision not submitted for this round'))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('forwards forceSettle: true through to processRoundWithAdminSdk when the teacher explicitly opts in', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', status: 'RUNNING', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const result = {
      newHouseholdState: { householdId: 'case-b' }, occurredEventIds: [], incomeYen: 0, expensesYen: 0,
      netCashFlowYen: 0, shortfallYen: 0, insuranceBenefitsYen: 0,
    }
    vi.mocked(processRoundWithAdminSdk).mockResolvedValue(result as never)

    await expect(processRoundCallable.run(makeProcessRoundRequest({ forceSettle: true }))).resolves.toEqual(result)
    expect(processRoundWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: true,
    })
  })

  /**
   * Important I2 (final whole-branch review): a teacher must not be able to
   * settle further rounds on a lesson that is already
   * COMPLETED/ABORTED/INTERRUPTED/etc. — previously this Callable never
   * checked `LessonRun.status` at all. Mirrors `market/onCall.ts`'s
   * `isMarketAcceptingOrdersWithAdminSdk` precedent (status !== 'RUNNING' →
   * rejected), placed after teacher-role + active-org-member authorization
   * has resolved but before `processRoundWithAdminSdk` is ever invoked.
   */
  describe('lesson-status gate (Important I2)', () => {
    it.each(['COMPLETED', 'ABORTED', 'INTERRUPTED', 'WAITING', 'PAUSED'])(
      'rejects with failed-precondition when the LessonRun status is %s, never calling processRoundWithAdminSdk',
      async (status) => {
        lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', status, teacherRoles: { 'teacher-a': 'PRIMARY' } }))
        vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
        await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
        expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
      },
    )

    it('rejects with failed-precondition when the LessonRun has no status field at all', async () => {
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
      vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
      await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
      expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
    })

    it('checks status only after teacher-role authorization has already passed (ordering)', async () => {
      // No teacherRoles entry for teacher-a at all — authorization must
      // still fail with permission-denied, not the status gate's
      // failed-precondition, proving the status check runs strictly after
      // authorization.
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', status: 'COMPLETED', teacherRoles: {} }))
      await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'permission-denied' })
      expect(requireActiveOrgMember).not.toHaveBeenCalled()
      expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
    })
  })
})

interface WriteHouseholdCheckpointRequestData {
  lessonRunId: string
  phaseId: string
  sequence: number
  householdIds: string[]
  idempotencyKey: string
}

const makeWriteCheckpointRequest = (
  data: Partial<WriteHouseholdCheckpointRequestData> = {}, uid = 'teacher-a',
): CallableRequest<WriteHouseholdCheckpointRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: {
    lessonRunId: 'run-1', phaseId: 'phase-1', sequence: 3, householdIds: ['case-b'], idempotencyKey: 'key-1',
    ...data,
  },
  rawRequest: {},
} as unknown as CallableRequest<WriteHouseholdCheckpointRequestData>)

describe('writeHouseholdCheckpointCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(household)
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<WriteHouseholdCheckpointRequestData>
    await expect(writeHouseholdCheckpointCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['phaseId', { phaseId: '' }],
    ['sequence', { sequence: -1 }],
    ['householdIds empty', { householdIds: [] }],
    ['householdIds with a non-string element', { householdIds: [123 as unknown as string] }],
    ['idempotencyKey', { idempotencyKey: '' }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(writeCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (never trusting a client-asserted role)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(writeCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when a named household cannot be found', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(writeCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('happy path: an ASSISTANT-role teacher who is an active org member builds a snapshot from every named household and writes it via writeCheckpointWithAdminSdk', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(writeCheckpointWithAdminSdk).mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

    const result = await writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())

    expect(result).toEqual({ checkpointId: 'cp-1', deduplicated: false })
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-1', 'teacher-a')
    expect(writeCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', phaseId: 'phase-1', sequence: 3,
      snapshot: { schemaVersion: 1, households: [household] },
      createdBy: 'TEACHER', idempotencyKey: 'key-1',
    })
  })

  it('translates an idempotency key payload mismatch into failed-precondition', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(writeCheckpointWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest()))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })
})

interface RestoreHouseholdCheckpointRequestData {
  lessonRunId: string
  checkpointId: string
  reason: string
  idempotencyKey: string
}

const makeRestoreCheckpointRequest = (
  data: Partial<RestoreHouseholdCheckpointRequestData> = {}, uid = 'teacher-a',
): CallableRequest<RestoreHouseholdCheckpointRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: { lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'undo mistaken settlement', idempotencyKey: 'key-1', ...data },
  rawRequest: {},
} as unknown as CallableRequest<RestoreHouseholdCheckpointRequestData>)

describe('restoreHouseholdCheckpointCallable', () => {
  const snapshotSetCalls: Array<{ path: string; data: unknown }> = []
  const runTransactionMock = vi.fn(async (fn: (tx: { set: (path: string, data: unknown) => void }) => Promise<void>) => {
    await fn({ set: (path, data) => snapshotSetCalls.push({ path, data }) })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    snapshotSetCalls.length = 0
    vi.mocked(householdRepositoryWithAdminSdk).mockReturnValue({ runTransaction: runTransactionMock as never })
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<RestoreHouseholdCheckpointRequestData>
    await expect(restoreHouseholdCheckpointCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['checkpointId', { checkpointId: '' }],
    ['reason', { reason: '  ' }],
    ['idempotencyKey', { idempotencyKey: '' }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run, never calling restoreCheckpointWithAdminSdk', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (never trusting a client-asserted role)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('happy path: an ASSISTANT-role teacher who is an active org member restores the checkpoint and writes every household back to Firestore', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockResolvedValue({ newRestoreGeneration: 2, eventId: 'evt-1', deduplicated: false })
    checkpointGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'snapshot' ? { schemaVersion: 1, households: [household] } : undefined),
    })

    const result = await restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())

    expect(result).toEqual({ newRestoreGeneration: 2, eventId: 'evt-1', deduplicated: false, restoredHouseholdIds: ['case-b'] })
    expect(restoreCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'undo mistaken settlement', actorId: 'teacher-a', idempotencyKey: 'key-1',
    })
    // Proves restore genuinely persists the restored HouseholdState back to
    // Firestore — not just returning it to the caller unpersisted.
    expect(snapshotSetCalls).toEqual([{ path: 'lessonRuns/run-1/households/case-b', data: household }])
  })

  it('translates "Checkpoint not found" from restoreCheckpointWithAdminSdk into not-found, writing nothing back', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockRejectedValue(new Error('Checkpoint not found'))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(snapshotSetCalls).toHaveLength(0)
  })

  it('translates an idempotency key payload mismatch into failed-precondition', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest()))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })
})
