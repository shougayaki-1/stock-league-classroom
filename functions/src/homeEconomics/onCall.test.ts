import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  getHouseholdAssignmentCallable,
  getHouseholdTeacherDashboardCallable,
  prepareHouseholdAssignmentCallable,
  processHouseholdRoundBatchCallable,
  processRoundCallable,
  restoreHouseholdCheckpointCallable,
  retryHouseholdRoundBatchCallable,
  submitHouseholdDecisionCallable,
  updateHouseholdAssignmentCallable,
  writeHouseholdCheckpointCallable,
} from './onCall'
import {
  getHouseholdRuntimeControlWithAdminSdk,
  getHouseholdStateWithAdminSdk,
  getOrInitHouseholdState,
  householdRepositoryWithAdminSdk,
  saveAdvancedHouseholdDecisionWithAdminSdk,
  saveHouseholdDecision,
} from '../lessonRuns/households/repository'
import { ensureAssignedHouseholdStateWithAdminSdk } from './assignedHousehold'
import { requireActiveOrgMember } from '../organizations/authorization'
import { restoreCheckpointWithAdminSdk, writeCheckpointWithAdminSdk } from '../lessonRuns/checkpoint'
import { processRoundWithAdminSdk } from './processRound'
import { findActiveBulkSettlementLeaseWithAdminSdk } from './bulkSettlementOperation'
import { loadHouseholdTeacherDashboardWithAdminSdk } from './teacherDashboard'
import {
  processHouseholdRoundBatchWithAdminSdk,
  retryHouseholdRoundBatchWithAdminSdk,
} from './bulkSettlement'
import {
  saveManualAdvancedHouseholdCheckpointWithAdminSdk,
  saveManualHouseholdCheckpointWithAdminSdk,
} from './householdCheckpoint'
import { restoreHouseholdCheckpointV2WithAdminSdk } from './householdRestore'
import {
  buildHouseholdAssignmentView,
  getHouseholdAssignmentView,
  prepareHouseholdAssignment,
  updateHouseholdAssignment,
} from './householdAssignmentRepository'

const participantGetMock = vi.fn()
const teamGetMock = vi.fn()
const lessonRunGetMock = vi.fn()
const checkpointGetMock = vi.fn()
const teamsIndexGetMock = vi.fn()
const teamsCollectionGetMock = vi.fn()
const assignmentConfigGetMock = vi.fn()
const assignmentEntryGetMock = vi.fn()
const runtimeControlGetMock = vi.fn()
const teamDocPaths: string[] = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (/^lessonRuns\/[^/]+$/.test(path)) return { get: lessonRunGetMock }
      if (path.includes('/checkpoints/')) return { get: checkpointGetMock }
      if (path.endsWith('/meta/teamsIndex')) return { get: teamsIndexGetMock }
      if (path.endsWith('/householdRuntime/control')) return { get: runtimeControlGetMock }
      if (path.endsWith('/householdAssignment/config')) return { get: assignmentConfigGetMock }
      if (path.includes('/householdAssignment/config/entries/')) return { get: assignmentEntryGetMock }
      if (!path.includes('/participantsByAuthUid/')) teamDocPaths.push(path)
      return { get: path.includes('/participantsByAuthUid/') ? participantGetMock : teamGetMock }
    },
    collection: (path: string) => {
      if (path.endsWith('/teams')) return { get: teamsCollectionGetMock }
      return { get: vi.fn().mockResolvedValue({ docs: [] }) }
    },
  }),
}))

vi.mock('./householdAssignmentRepository', () => ({
  getHouseholdAssignmentView: vi.fn(),
  prepareHouseholdAssignment: vi.fn(),
  updateHouseholdAssignment: vi.fn(),
  buildHouseholdAssignmentView: vi.fn(),
  householdAssignmentReadDepsWithAdminSdk: vi.fn(() => ({})),
  householdAssignmentRepositoryWithAdminSdk: vi.fn(() => ({})),
}))

vi.mock('../lessonRuns/households/repository', () => ({
  getHouseholdRuntimeControlWithAdminSdk: vi.fn(),
  getHouseholdStateWithAdminSdk: vi.fn(),
  getOrInitHouseholdState: vi.fn(),
  householdRepositoryWithAdminSdk: vi.fn(() => ({})),
  saveAdvancedHouseholdDecisionWithAdminSdk: vi.fn(),
  saveHouseholdDecision: vi.fn(),
}))

vi.mock('./assignedHousehold', () => ({
  ensureAssignedHouseholdStateWithAdminSdk: vi.fn(),
}))

vi.mock('../lessonRuns/checkpoint', () => ({
  writeCheckpointWithAdminSdk: vi.fn(),
  restoreCheckpointWithAdminSdk: vi.fn(),
}))

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./processRound', () => ({ processRoundWithAdminSdk: vi.fn() }))
vi.mock('./bulkSettlementOperation', () => ({
  findActiveBulkSettlementLeaseWithAdminSdk: vi.fn().mockResolvedValue(null),
}))
vi.mock('./teacherDashboard', () => ({
  loadHouseholdTeacherDashboardWithAdminSdk: vi.fn(),
}))
vi.mock('./bulkSettlement', () => ({
  processHouseholdRoundBatchWithAdminSdk: vi.fn(),
  retryHouseholdRoundBatchWithAdminSdk: vi.fn(),
}))
vi.mock('./householdCheckpoint', () => ({
  saveManualHouseholdCheckpointWithAdminSdk: vi.fn(),
  saveManualAdvancedHouseholdCheckpointWithAdminSdk: vi.fn(),
}))
vi.mock('./householdRestore', () => ({
  restoreHouseholdCheckpointV2WithAdminSdk: vi.fn(),
}))

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
  householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 500000,
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

    it('rejects with failed-precondition when a COMMON_CONDITIONS template has more than one profile', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
        templateSnapshot: {
          homeEconomics: { ...homeEconomicsContent, households: [...homeEconomicsContent.households, { ...homeEconomicsContent.households[0], householdId: 'template-profile-2' }] },
        },
      }))
      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
      expect(getOrInitHouseholdState).not.toHaveBeenCalled()
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
    })

    // Task 5: a course format outside COMMON_CONDITIONS is no longer an
    // automatic lazy-init failure — ROLE_VARIANT/STAGE_SPLIT/
    // MULTI_PERSON_PER_TEAM now route through the advanced FROZEN-assignment
    // path (`resolveAdvancedHousehold`) instead. This proves that routing
    // actually happens (rejecting for a DIFFERENT reason — the assignment
    // has not been prepared — rather than the old COMMON-ONLY message), and
    // that no household is ever created or saved from it.
    it('routes a missing household under ROLE_VARIANT through the advanced assignment path, not the COMMON-ONLY lazy-init failure', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
        templateSnapshot: { homeEconomics: { ...homeEconomicsContent, courseFormat: 'ROLE_VARIANT' } },
      }))
      assignmentConfigGetMock.mockResolvedValue({ exists: false })
      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({
        code: 'failed-precondition', message: expect.not.stringContaining('共通条件モードでプロフィールが1件'),
      })
      expect(getOrInitHouseholdState).not.toHaveBeenCalled()
      expect(ensureAssignedHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
      expect(saveAdvancedHouseholdDecisionWithAdminSdk).not.toHaveBeenCalled()
    })

    it('lazily creates the household from the template\'s sole profile, keyed by householdId===teamId, then proceeds to save the decision', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { status: 'RUNNING', templateSnapshot: { homeEconomics: homeEconomicsContent } }))
      const initializedHousehold = {
        householdId: 'case-b', lessonRunId: 'run-1', teamId: 'case-b', profileId: 'case-b', cashYen: 500000,
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

  /**
   * Task 5: the 3 advanced course formats (ROLE_VARIANT/STAGE_SPLIT/
   * MULTI_PERSON_PER_TEAM) route through `resolveAdvancedHousehold` +
   * `saveAdvancedHouseholdDecisionWithAdminSdk` instead of the Common
   * lazy-init/`saveHouseholdDecision` flow above, guarded by the shared
   * `HouseholdRuntimeControl` document.
   */
  describe('advanced course formats (Task 5)', () => {
    const roleVariantRunFields = {
      status: 'RUNNING',
      templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [] } },
    }
    const control = {
      courseFormat: 'ROLE_VARIANT', assignmentRevision: 1, synchronizedRoundIndex: 3,
      roundStatus: 'OPEN', activeOperationId: null, updatedAtServerMillis: 0,
    }
    const advancedHousehold = {
      householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'profile-x', cashYen: 500000,
      assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'INDEPENDENT', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
    }
    const savedRecord = {
      decisionId: 'run-1_decision_xyz', lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
      shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
      submittedAtServerMillis: 999,
    }

    beforeEach(() => {
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, roleVariantRunFields))
      runtimeControlGetMock.mockResolvedValue({ exists: true, data: () => control })
      vi.mocked(getHouseholdRuntimeControlWithAdminSdk).mockResolvedValue(control as never)
      teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['p-1'] }) })
    })

    it('existing state -> stored teamId -> membership: resolves ownership from the household\'s own stored teamId and saves via the advanced path', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(advancedHousehold)
      vi.mocked(saveAdvancedHouseholdDecisionWithAdminSdk).mockResolvedValue(savedRecord)

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).resolves.toEqual(savedRecord)

      expect(teamDocPaths.some((path) => path.endsWith('/teams/team-a'))).toBe(true)
      expect(ensureAssignedHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
      expect(saveAdvancedHouseholdDecisionWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
        lessonRunId: 'run-1', householdId: 'case-b',
        expectedSynchronizedRoundIndex: 3, assignmentRevision: 1, idempotencyKey: 'key-1',
        decision: expect.objectContaining({ lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3 }),
      }))
      expect(saveHouseholdDecision).not.toHaveBeenCalled()
    })

    it('missing state -> FROZEN assignment teamId -> membership -> ensure: resolves teamId from the frozen assignment BEFORE creating anything', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      assignmentConfigGetMock.mockResolvedValue({ exists: true, data: () => ({ state: 'FROZEN', assignmentRevision: 1 }) })
      assignmentEntryGetMock.mockResolvedValue({ exists: true, data: () => ({ teamId: 'team-a', profileId: 'profile-x' }) })
      vi.mocked(ensureAssignedHouseholdStateWithAdminSdk).mockResolvedValue(advancedHousehold)
      vi.mocked(saveAdvancedHouseholdDecisionWithAdminSdk).mockResolvedValue(savedRecord)

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).resolves.toEqual(savedRecord)

      expect(teamDocPaths.some((path) => path.endsWith('/teams/team-a'))).toBe(true)
      expect(ensureAssignedHouseholdStateWithAdminSdk).toHaveBeenCalledWith('run-1', 'case-b')
      expect(saveAdvancedHouseholdDecisionWithAdminSdk).toHaveBeenCalled()
    })

    it('rejects with permission-denied when the caller is not a member of the FROZEN assignment\'s teamId, without ever calling ensureAssignedHouseholdStateWithAdminSdk', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
      assignmentConfigGetMock.mockResolvedValue({ exists: true, data: () => ({ state: 'FROZEN', assignmentRevision: 1 }) })
      assignmentEntryGetMock.mockResolvedValue({ exists: true, data: () => ({ teamId: 'team-a', profileId: 'profile-x' }) })
      teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['someone-else'] }) })

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })

      expect(ensureAssignedHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
      expect(saveAdvancedHouseholdDecisionWithAdminSdk).not.toHaveBeenCalled()
    })

    it('another team\'s runtime household rejected: an existing household owned by a different team is never authorized from client input', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue({ ...advancedHousehold, teamId: 'team-other' })
      teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['someone-else'] }) })

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })

      expect(teamDocPaths.some((path) => path.endsWith('/teams/team-other'))).toBe(true)
      expect(saveAdvancedHouseholdDecisionWithAdminSdk).not.toHaveBeenCalled()
    })

    it('translates a SETTLING rejection from saveAdvancedHouseholdDecisionWithAdminSdk into failed-precondition', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(advancedHousehold)
      vi.mocked(saveAdvancedHouseholdDecisionWithAdminSdk).mockRejectedValue(
        new Error('HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)'),
      )

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({
        code: 'failed-precondition', message: 'HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)',
      })
    })

    it('translates an assignmentRevision mismatch into failed-precondition', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(advancedHousehold)
      vi.mocked(saveAdvancedHouseholdDecisionWithAdminSdk).mockRejectedValue(
        new Error('HouseholdRuntimeControl assignmentRevision does not match the expected assignment revision'),
      )

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    it('translates a round-consistency mismatch into failed-precondition', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(advancedHousehold)
      vi.mocked(saveAdvancedHouseholdDecisionWithAdminSdk).mockRejectedValue(
        new Error('Requested round no longer matches the synchronized round'),
      )

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    it('rejects with failed-precondition, without calling save, when the HouseholdRuntimeControl document does not exist yet', async () => {
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(advancedHousehold)
      vi.mocked(getHouseholdRuntimeControlWithAdminSdk).mockResolvedValue(null)

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
      expect(saveAdvancedHouseholdDecisionWithAdminSdk).not.toHaveBeenCalled()
    })

    // Common regression: this whole advanced branch must not fire, and the
    // pre-existing Common flow must behave exactly as before, when the
    // LessonRun's courseFormat is COMMON_CONDITIONS (or absent).
    it('Common regression: a COMMON_CONDITIONS lessonRun never touches the advanced resolution/save path', async () => {
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { status: 'RUNNING' }))
      vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(household)
      vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })

      await expect(submitHouseholdDecisionCallable.run(makeRequest())).resolves.toEqual({ decisionId: 'dec-1', created: true })

      expect(ensureAssignedHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
      expect(saveAdvancedHouseholdDecisionWithAdminSdk).not.toHaveBeenCalled()
      expect(getHouseholdRuntimeControlWithAdminSdk).not.toHaveBeenCalled()
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

  /**
   * Task 6 / Global Constraint: 発展3形式は通常の個別決算を server-side で
   * 拒否する。処理は bulk 経路（processHouseholdRoundBatchCallable /
   * retryHouseholdRoundBatchCallable）からのみ許可される —
   * `processRoundWithAdminSdk` そのものは変更せず、bulk 実行が内部から
   * 呼び出し続ける。
   */
  describe('advanced course format rejection (Task 6)', () => {
    it.each(['ROLE_VARIANT', 'STAGE_SPLIT', 'MULTI_PERSON_PER_TEAM'])(
      'rejects with failed-precondition for %s, never calling processRoundWithAdminSdk',
      async (courseFormat) => {
        lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
          orgId: 'org-1', status: 'RUNNING', teacherRoles: { 'teacher-a': 'PRIMARY' },
          templateSnapshot: { homeEconomics: { courseFormat, households: [] } },
        }))
        vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })

        await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
        expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
      },
    )

    it('still allows COMMON_CONDITIONS through (regression)', async () => {
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
        orgId: 'org-1', status: 'RUNNING', teacherRoles: { 'teacher-a': 'PRIMARY' },
        templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS', households: [] } },
      }))
      vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
      const result = {
        newHouseholdState: { householdId: 'case-b' }, occurredEventIds: [], incomeYen: 0, expensesYen: 0,
        netCashFlowYen: 0, shortfallYen: 0, insuranceBenefitsYen: 0,
      }
      vi.mocked(processRoundWithAdminSdk).mockResolvedValue(result as never)

      await expect(processRoundCallable.run(makeProcessRoundRequest())).resolves.toEqual(result)
    })

    it('checks the course format only after teacher-role authorization has already passed (ordering)', async () => {
      lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
        orgId: 'org-1', status: 'RUNNING', teacherRoles: {},
        templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [] } },
      }))
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

  it('calls saveManualHouseholdCheckpointWithAdminSdk when label is provided', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(saveManualHouseholdCheckpointWithAdminSdk).mockResolvedValue({ checkpointId: 'hcp-1', created: true })

    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', label: '手動チェックポイント', idempotencyKey: 'k-1' },
      rawRequest: {},
    } as never

    const result = await writeHouseholdCheckpointCallable.run(req)
    expect(result).toEqual({ checkpointId: 'hcp-1', created: true })
    expect(saveManualHouseholdCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1',
      label: '手動チェックポイント',
      actorUid: 'teacher-a',
      idempotencyKey: 'k-1',
    })
  })

  it('translates an idempotency key payload mismatch into failed-precondition', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(writeCheckpointWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest()))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })

  it('dispatches to saveManualAdvancedHouseholdCheckpointWithAdminSdk (v3) when the lesson courseFormat is advanced, not the Common v2 function', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      teacherRoles: { 'teacher-a': 'PRIMARY' },
      templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT' } },
    }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(saveManualAdvancedHouseholdCheckpointWithAdminSdk).mockResolvedValue({ checkpointId: 'hcp-v3-1', created: true })

    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', label: '手動チェックポイント', idempotencyKey: 'k-1' },
      rawRequest: {},
    } as never

    const result = await writeHouseholdCheckpointCallable.run(req)
    expect(result).toEqual({ checkpointId: 'hcp-v3-1', created: true })
    expect(saveManualAdvancedHouseholdCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1',
      label: '手動チェックポイント',
      actorUid: 'teacher-a',
      idempotencyKey: 'k-1',
    })
    expect(saveManualHouseholdCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an advanced manual checkpoint attempt while the round is SETTLING (a bulk operation is in progress)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      teacherRoles: { 'teacher-a': 'PRIMARY' },
      templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT' } },
    }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(saveManualAdvancedHouseholdCheckpointWithAdminSdk).mockRejectedValue(
      new Error('HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)'),
    )

    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', label: '手動チェックポイント', idempotencyKey: 'k-1' },
      rawRequest: {},
    } as never

    await expect(writeHouseholdCheckpointCallable.run(req)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)',
    })
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

  it('rejects when active bulk settlement lease is present', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', status: 'RUNNING', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(findActiveBulkSettlementLeaseWithAdminSdk).mockResolvedValue({ operationId: 'op-1' } as never)

    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({
      code: 'failed-precondition',
      message: '一括決算処理が実行中のため、個別の決算は行えません。',
    })
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })
})

describe('getHouseholdTeacherDashboardCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      subject: 'HOME_ECONOMICS',
      templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS' } },
      teacherRoles: { 'teacher-a': 'VIEWER' },
    }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
  })

  it('rejects unauthenticated callers', async () => {
    const req = { auth: undefined, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
    await expect(getHouseholdTeacherDashboardCallable.run(req)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects missing lessonRunId', async () => {
    const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: '' }, rawRequest: {} } as never
    await expect(getHouseholdTeacherDashboardCallable.run(req)).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects non-teacher callers', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      subject: 'HOME_ECONOMICS',
      teacherRoles: {},
    }))
    const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
    await expect(getHouseholdTeacherDashboardCallable.run(req)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('loads dashboard for any teacher role including VIEWER', async () => {
    const mockDashboard = { lessonRunId: 'run-1', households: [] }
    vi.mocked(loadHouseholdTeacherDashboardWithAdminSdk).mockResolvedValue(mockDashboard as never)

    const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
    const result = await getHouseholdTeacherDashboardCallable.run(req)

    expect(result).toEqual(mockDashboard)
    expect(loadHouseholdTeacherDashboardWithAdminSdk).toHaveBeenCalledWith('run-1', expect.any(Number))
  })
})

describe('processHouseholdRoundBatchCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      status: 'RUNNING',
      subject: 'HOME_ECONOMICS',
      templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS' } },
      teacherRoles: { 'teacher-a': 'PRIMARY' },
    }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
  })

  it('rejects non-PRIMARY teacher', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      status: 'RUNNING',
      teacherRoles: { 'teacher-a': 'ASSISTANT' },
    }))
    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', expectedRoundIndex: 1, forceUnsubmitted: false, idempotencyKey: 'k-1' },
      rawRequest: {},
    } as never
    await expect(processHouseholdRoundBatchCallable.run(req)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('calls processHouseholdRoundBatchWithAdminSdk on happy path', async () => {
    const mockView = { operationId: 'op-1', status: 'COMPLETED' }
    vi.mocked(processHouseholdRoundBatchWithAdminSdk).mockResolvedValue(mockView as never)

    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', expectedRoundIndex: 1, forceUnsubmitted: false, idempotencyKey: 'k-1' },
      rawRequest: {},
    } as never
    const result = await processHouseholdRoundBatchCallable.run(req)

    expect(result).toEqual(mockView)
    expect(processHouseholdRoundBatchWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1',
      expectedRoundIndex: 1,
      forceUnsubmitted: false,
      actorUid: 'teacher-a',
      idempotencyKey: 'k-1',
    }))
  })
})

describe('retryHouseholdRoundBatchCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      status: 'RUNNING',
      teacherRoles: { 'teacher-a': 'PRIMARY' },
    }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
  })

  it('rejects non-PRIMARY teacher', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      status: 'RUNNING',
      teacherRoles: { 'teacher-a': 'ASSISTANT' },
    }))
    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', operationId: 'op-1' },
      rawRequest: {},
    } as never
    await expect(retryHouseholdRoundBatchCallable.run(req)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('calls retryHouseholdRoundBatchWithAdminSdk on happy path', async () => {
    const mockView = { operationId: 'op-1', status: 'COMPLETED' }
    vi.mocked(retryHouseholdRoundBatchWithAdminSdk).mockResolvedValue(mockView as never)

    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', operationId: 'op-1' },
      rawRequest: {},
    } as never
    const result = await retryHouseholdRoundBatchCallable.run(req)

    expect(result).toEqual(mockView)
    expect(retryHouseholdRoundBatchWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1',
      operationId: 'op-1',
      actorUid: 'teacher-a',
    }))
  })
})

describe('restoreHouseholdCheckpointCallable v2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
  })

  it('rejects when active bulk lease is present', async () => {
    vi.mocked(restoreHouseholdCheckpointV2WithAdminSdk).mockRejectedValue(new Error('Active bulk operation lease is active'))
    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'restore', idempotencyKey: 'k-1' },
      rawRequest: {},
    } as never

    await expect(restoreHouseholdCheckpointCallable.run(req)).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('calls restoreHouseholdCheckpointV2WithAdminSdk on happy path', async () => {
    const mockResult = { newRestoreGeneration: 2, restoredHouseholdIds: ['team-a'], preRestoreCheckpointId: 'pre-1' }
    vi.mocked(restoreHouseholdCheckpointV2WithAdminSdk).mockResolvedValue(mockResult)
    const req = {
      auth: { uid: 'teacher-a' },
      data: { lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'restore', idempotencyKey: 'k-1' },
      rawRequest: {},
    } as never

    const result = await restoreHouseholdCheckpointCallable.run(req)
    expect(result).toEqual(mockResult)
    expect(restoreHouseholdCheckpointV2WithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1',
      checkpointId: 'cp-1',
      reason: 'restore',
      actorUid: 'teacher-a',
      idempotencyKey: 'k-1',
    }))
  })
})

describe('household assignment Callables (Task 2)', () => {
  const roleVariantContent = {
    households: [{
      householdId: 'profile-1', age: 30, householdIncomeYen: 5000000, annualLivingExpensesYen: 3000000,
      cashSavingsYen: 1000000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄', lifeStage: 'INDEPENDENT',
      eventProbabilityOverrides: {}, internalRiskFactors: {},
    }],
    courseFormat: 'ROLE_VARIANT',
  }
  const commonContent = {
    households: [{
      householdId: 'profile-1', age: 30, householdIncomeYen: 5000000, annualLivingExpensesYen: 3000000,
      cashSavingsYen: 1000000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄', lifeStage: 'INDEPENDENT',
      eventProbabilityOverrides: {}, internalRiskFactors: {},
    }],
    courseFormat: 'COMMON_CONDITIONS',
  }

  const setLessonRun = (teacherRoles: Record<string, string>, homeEconomics: unknown = roleVariantContent) => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, {
      orgId: 'org-1',
      subject: 'HOME_ECONOMICS',
      teacherRoles,
      templateSnapshot: { homeEconomics },
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    teamsIndexGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'teamIds' ? ['team-a', 'team-b'] : undefined) })
    teamsCollectionGetMock.mockResolvedValue({ docs: [] })
  })

  describe('getHouseholdAssignmentCallable', () => {
    it('rejects unauthenticated callers', async () => {
      const req = { auth: undefined, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
      await expect(getHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    it('rejects a caller with no teacherRole on the lesson', async () => {
      setLessonRun({})
      const req = { auth: { uid: 'stranger' }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
      await expect(getHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'permission-denied' })
    })

    it.each(['PRIMARY', 'ASSISTANT', 'VIEWER'])('allows %s to read the view (VIEW_PROGRESS is allowed for every role)', async (role) => {
      setLessonRun({ 'teacher-a': role })
      const view = { lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1, warnings: [], teams: [] }
      vi.mocked(getHouseholdAssignmentView).mockResolvedValue(view as never)

      const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
      const result = await getHouseholdAssignmentCallable.run(req)
      expect(result).toEqual(view)
    })

    it('returns the implicit compatibility view for COMMON_CONDITIONS', async () => {
      setLessonRun({ 'teacher-a': 'VIEWER' }, commonContent)
      const view = { lessonRunId: 'run-1', courseFormat: 'COMMON_CONDITIONS', state: 'FROZEN', validationStatus: 'READY', assignmentRevision: null, warnings: [], teams: [] }
      vi.mocked(getHouseholdAssignmentView).mockResolvedValue(view as never)

      const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
      const result = await getHouseholdAssignmentCallable.run(req)
      expect(result).toEqual(view)
      expect(getHouseholdAssignmentView).toHaveBeenCalledWith(expect.objectContaining({ courseFormat: 'COMMON_CONDITIONS', commonProfile: expect.objectContaining({ householdId: 'profile-1' }) }))
    })
  })

  describe('prepareHouseholdAssignmentCallable', () => {
    it('rejects unauthenticated callers', async () => {
      const req = { auth: undefined, data: { lessonRunId: 'run-1', idempotencyKey: 'k-1' }, rawRequest: {} } as never
      await expect(prepareHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    it('rejects a request missing idempotencyKey', async () => {
      const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as never
      await expect(prepareHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it.each(['ASSISTANT', 'VIEWER'])('rejects a %s from preparing the assignment', async (role) => {
      setLessonRun({ 'teacher-a': role })
      const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1', idempotencyKey: 'k-1' }, rawRequest: {} } as never
      await expect(prepareHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'permission-denied' })
      expect(prepareHouseholdAssignment).not.toHaveBeenCalled()
    })

    it('rejects PRIMARY preparing a COMMON_CONDITIONS assignment', async () => {
      setLessonRun({ 'teacher-a': 'PRIMARY' }, commonContent)
      const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1', idempotencyKey: 'k-1' }, rawRequest: {} } as never
      await expect(prepareHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'failed-precondition' })
      expect(prepareHouseholdAssignment).not.toHaveBeenCalled()
    })

    it('allows PRIMARY to prepare an advanced-format assignment before FROZEN', async () => {
      setLessonRun({ 'teacher-a': 'PRIMARY' })
      const mutationResult = { config: { courseFormat: 'ROLE_VARIANT', state: 'DRAFT', assignmentRevision: 1 }, entries: [], deduplicated: false }
      vi.mocked(prepareHouseholdAssignment).mockResolvedValue(mutationResult as never)
      const view = { lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1, warnings: [], teams: [] }
      vi.mocked(buildHouseholdAssignmentView).mockReturnValue(view as never)

      const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1', idempotencyKey: 'k-1' }, rawRequest: {} } as never
      const result = await prepareHouseholdAssignmentCallable.run(req)

      expect(result).toEqual(view)
      expect(prepareHouseholdAssignment).toHaveBeenCalledWith(expect.objectContaining({
        lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', teamIds: ['team-a', 'team-b'],
        actorUid: 'teacher-a', idempotencyKey: 'k-1',
      }))
    })

    it('translates a frozen-assignment error to failed-precondition', async () => {
      setLessonRun({ 'teacher-a': 'PRIMARY' })
      vi.mocked(prepareHouseholdAssignment).mockRejectedValue(new Error('HouseholdAssignment is frozen'))
      const req = { auth: { uid: 'teacher-a' }, data: { lessonRunId: 'run-1', idempotencyKey: 'k-1' }, rawRequest: {} } as never
      await expect(prepareHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'failed-precondition' })
    })
  })

  describe('updateHouseholdAssignmentCallable', () => {
    const baseData = { lessonRunId: 'run-1', expectedRevision: 1, changes: [{ householdId: 'h-1', displayOrder: 2 }], idempotencyKey: 'k-1' }

    it('rejects unauthenticated callers', async () => {
      const req = { auth: undefined, data: baseData, rawRequest: {} } as never
      await expect(updateHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    it('rejects a request with an empty changes array', async () => {
      const req = { auth: { uid: 'teacher-a' }, data: { ...baseData, changes: [] }, rawRequest: {} } as never
      await expect(updateHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it.each(['ASSISTANT', 'VIEWER'])('rejects a %s from updating the assignment', async (role) => {
      setLessonRun({ 'teacher-a': role })
      const req = { auth: { uid: 'teacher-a' }, data: baseData, rawRequest: {} } as never
      await expect(updateHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'permission-denied' })
      expect(updateHouseholdAssignment).not.toHaveBeenCalled()
    })

    it('allows PRIMARY to update an advanced-format assignment', async () => {
      setLessonRun({ 'teacher-a': 'PRIMARY' })
      const mutationResult = { config: { courseFormat: 'ROLE_VARIANT', state: 'DRAFT', assignmentRevision: 2 }, entries: [], deduplicated: false }
      vi.mocked(updateHouseholdAssignment).mockResolvedValue(mutationResult as never)
      const view = { lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 2, warnings: [], teams: [] }
      vi.mocked(buildHouseholdAssignmentView).mockReturnValue(view as never)

      const req = { auth: { uid: 'teacher-a' }, data: baseData, rawRequest: {} } as never
      const result = await updateHouseholdAssignmentCallable.run(req)

      expect(result).toEqual(view)
      expect(updateHouseholdAssignment).toHaveBeenCalledWith(expect.objectContaining({
        lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', expectedRevision: 1, changes: baseData.changes,
        actorUid: 'teacher-a', idempotencyKey: 'k-1',
      }))
    })

    it('translates a revision-mismatch error to failed-precondition', async () => {
      setLessonRun({ 'teacher-a': 'PRIMARY' })
      vi.mocked(updateHouseholdAssignment).mockRejectedValue(new Error('Revision mismatch'))
      const req = { auth: { uid: 'teacher-a' }, data: baseData, rawRequest: {} } as never
      await expect(updateHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    it('rejects PRIMARY updating a COMMON_CONDITIONS assignment', async () => {
      setLessonRun({ 'teacher-a': 'PRIMARY' }, commonContent)
      const req = { auth: { uid: 'teacher-a' }, data: baseData, rawRequest: {} } as never
      await expect(updateHouseholdAssignmentCallable.run(req)).rejects.toMatchObject({ code: 'failed-precondition' })
      expect(updateHouseholdAssignment).not.toHaveBeenCalled()
    })
  })
})
