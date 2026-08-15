import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processRound, type ProcessRoundDeps } from './processRound'
import { settleRound, type SettleRoundResult } from './engine/settleRound'
import type { HouseholdState, StoredHouseholdState } from '../lessonRuns/households/repository'

/**
 * These tests exercise the pure `processRound` orchestration against fully
 * mocked deps — the Admin SDK wiring (`processRoundDepsWithAdminSdk`) is a
 * thin composition exercised indirectly via `onCall.test.ts`'s Callable
 * tests.
 */
describe('processRound', () => {
  const household: HouseholdState = {
    householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 500000,
    assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
    lifeStage: 'CHILD_REARING', roundIndex: 2, goalDelayedRounds: 0, updatedAtServerMillis: 0,
  }
  const profile = {
    householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
    annualLivingExpensesYen: 3000000, cashSavingsYen: 500000,
    family: '配偶者・子2人', housing: '賃貸マンション', lifeGoal: '住宅購入と教育資金',
    lifeStage: 'CHILD_REARING' as const, eventProbabilityOverrides: {}, internalRiskFactors: {},
  }
  const homeEconomics = {
    households: [profile], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
    publicSupportPrograms: [], roundYears: 5 as const, courseFormat: 'COMMON_CONDITIONS' as const,
    taxAndSocialInsuranceModelVersion: 1,
    economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
    borrowingAllowed: false, goalPackage: 'OVERALL_BALANCE' as const,
    evaluationWeights: {
      lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
    },
  }
  const settleResult: SettleRoundResult = {
    newHouseholdState: { ...household, roundIndex: 3, cashYen: 600000 },
    occurredEventIds: [], incomeYen: 4800000, expensesYen: 3000000,
    netCashFlowYen: 1800000, shortfallYen: 0, insuranceBenefitsYen: 0,
    shortfallOptionsConsidered: [],
  }
  // A submitted decision — used as the default so these orchestration tests
  // exercise the normal path (household HAS submitted). The submission-gate
  // itself (decision === null, forceSettle unset/true) is covered by the
  // dedicated tests below.
  const submittedDecision = {
    lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 2,
    assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [],
    shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
  }

  const makeDeps = (overrides: Partial<ProcessRoundDeps> = {}): ProcessRoundDeps => ({
    readLessonRunConfig: vi.fn().mockResolvedValue({
      orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics,
    }),
    readHouseholdState: vi.fn().mockResolvedValue(household),
    readHouseholdDecision: vi.fn().mockResolvedValue(submittedDecision),
    settleRoundFn: vi.fn().mockReturnValue(settleResult),
    commitRoundSettlement: vi.fn().mockResolvedValue({ status: 'COMMITTED' }),
    publishRealtimeState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  })

  it('throws when the HouseholdState does not exist', async () => {
    const deps = makeDeps({ readHouseholdState: vi.fn().mockResolvedValue(null) })
    await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' }))
      .rejects.toThrow('HouseholdState not found')
    expect(deps.settleRoundFn).not.toHaveBeenCalled()
  })

  it('throws when the household has no matching profile in the template snapshot', async () => {
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: { ...homeEconomics, households: [] },
      }),
    })
    await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' }))
      .rejects.toThrow('HouseholdProfile not found in template snapshot')
    expect(deps.settleRoundFn).not.toHaveBeenCalled()
  })

  it('reads the decision for the household\'s OWN current roundIndex, not a client-supplied one', async () => {
    const deps = makeDeps()
    await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(deps.readHouseholdDecision).toHaveBeenCalledWith('run-1', 'case-b', 2)
  })

  it('forwards assetCatalog (Step 4 fix) from the template snapshot into settleRoundFn', async () => {
    const catalog = [{ assetType: 'DOMESTIC_STOCK' as const, valueYen: 0, expectedReturnPercent: 5, volatilityPercent: 1 }]
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: { ...homeEconomics, assets: catalog },
      }),
    })
    await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ assetCatalog: catalog }))
  })

  it('calls settleRoundFn with the assembled household/profile/decision/config, then commits the result', async () => {
    const deps = makeDeps()
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({
      household, profile, decision: submittedDecision, randomSeed: 'seed-x', restoreGeneration: 0,
      taxModelVersion: 1, roundYears: 5, borrowingAllowed: false,
    }))
    expect(deps.commitRoundSettlement).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', orgId: 'org-1',
      expectedPriorRoundIndex: 2, result: settleResult, actorId: 'teacher-a',
      forcedSettlement: false, homeEconomicsContent: homeEconomics,
    })
  })

  /**
   * Task 4 — `household.profileId` (not the runtime `householdId`) is the
   * unambiguous key used to resolve the profile. This proves the resolution
   * still works correctly even when the runtime `householdId` (an opaque
   * per-team-slot id, `runtimeHouseholdId()`) is completely different from
   * the profileId it's running — the exact case the 3 advanced formats
   * introduce and the old array-length/courseFormat heuristic could not
   * handle unambiguously.
   */
  it('resolves the profile by household.profileId, independent of what the runtime householdId is', async () => {
    const assignedHousehold: HouseholdState = { ...household, householdId: 'household-runtime-1', profileId: 'case-b' }
    const deps = makeDeps({
      readHouseholdState: vi.fn().mockResolvedValue(assignedHousehold),
      readHouseholdDecision: vi.fn().mockResolvedValue({ ...submittedDecision, householdId: 'household-runtime-1' }),
    })
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'household-runtime-1', actorId: 'teacher-a' })
    expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ profile }))
  })

  /**
   * Task 4 — legacy documents written before `profileId` existed have no
   * such field on the stored data. Under COMMON_CONDITIONS with exactly one
   * authored profile, `resolveStoredHouseholdState` (called internally by
   * `processRound`) infers it from that sole profile, so settlement still
   * succeeds rather than throwing 'HouseholdProfile not found'.
   */
  it('resolves the sole profile for a legacy COMMON_CONDITIONS household document with no stored profileId', async () => {
    const legacyStored = { ...household, householdId: 'team-a' } as StoredHouseholdState
    delete (legacyStored as { profileId?: string }).profileId
    const deps = makeDeps({
      readHouseholdState: vi.fn().mockResolvedValue(legacyStored),
      readHouseholdDecision: vi.fn().mockResolvedValue({ ...submittedDecision, householdId: 'team-a' }),
    })
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'team-a', actorId: 'teacher-a' })
    expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ profile }))
  })

  /**
   * Task 4 — fail closed. There is no safe positional inference for a
   * missing `profileId` under an advanced course format (ROLE_VARIANT/
   * STAGE_SPLIT/MULTI_PERSON_PER_TEAM): a household with no recorded
   * profile identity is a data-integrity problem, not something to guess
   * at from array position or courseFormat alone (the exact fragility the
   * old heuristic had).
   */
  it('throws when profileId is missing on the stored household under an advanced course format', async () => {
    const advancedHomeEconomics = { ...homeEconomics, courseFormat: 'ROLE_VARIANT' as const }
    const legacyStored = { ...household, householdId: 'household-runtime-1' } as StoredHouseholdState
    delete (legacyStored as { profileId?: string }).profileId
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: advancedHomeEconomics,
      }),
      readHouseholdState: vi.fn().mockResolvedValue(legacyStored),
      readHouseholdDecision: vi.fn().mockResolvedValue({ ...submittedDecision, householdId: 'household-runtime-1' }),
    })
    await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'household-runtime-1', actorId: 'teacher-a' }))
      .rejects.toThrow(/profileId/)
    expect(deps.settleRoundFn).not.toHaveBeenCalled()
  })

  /**
   * Task 4 — STAGE_SPLIT assigns a household to a profile whose authored
   * `lifeStage` reflects that stage, but the household's OWN `lifeStage`
   * (the source of truth for settlement, see `settleRound.ts`) must never
   * be silently overwritten by the profile's `lifeStage` during settlement.
   * This runs the REAL `settleRound` engine (not a mock) precisely so it
   * proves actual settlement behavior, not just that the right arguments
   * were passed to a stub.
   */
  it('keeps household.lifeStage fixed after settlement even when it differs from the STAGE_SPLIT profile\'s lifeStage', async () => {
    const stageSplitProfile = { ...profile, lifeStage: 'RETIRED' as const }
    const stageSplitHomeEconomics = {
      ...homeEconomics, courseFormat: 'STAGE_SPLIT' as const, households: [stageSplitProfile],
    }
    const stageHousehold: HouseholdState = { ...household, lifeStage: 'CHILD_REARING' }
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: stageSplitHomeEconomics,
      }),
      readHouseholdState: vi.fn().mockResolvedValue(stageHousehold),
      readHouseholdDecision: vi.fn().mockResolvedValue(submittedDecision),
      settleRoundFn: settleRound,
    })
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(result.status).toBe('COMMITTED')
    if (result.status !== 'COMMITTED') throw new Error('unreachable')
    expect(result.settlement.newHouseholdState.lifeStage).toBe('CHILD_REARING')
  })

  /**
   * Task 15 — `publishRealtimeState` must actually be invoked (not left
   * unwired the way Phase C's RTDB broadcast was until its final
   * whole-branch review), with everything the Admin SDK implementation
   * needs to build the three RTDB writes, and only AFTER
   * `commitRoundSettlement` has committed (so the broadcast reflects the
   * just-written state, not a stale pre-settlement one).
   */
  it('calls publishRealtimeState with orgId/homeEconomics/profile/decision/result, after commitRoundSettlement', async () => {
    const deps = makeDeps()
    const callOrder: string[] = []
    ;(deps.commitRoundSettlement as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('commit')
      return { status: 'COMMITTED' }
    })
    ;(deps.publishRealtimeState as ReturnType<typeof vi.fn>).mockImplementation(async () => { callOrder.push('publish') })

    await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })

    expect(deps.publishRealtimeState).toHaveBeenCalledWith({
      lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile, decision: submittedDecision, result: settleResult,
    })
    expect(callOrder).toEqual(['commit', 'publish'])
  })

  /**
   * Task 11 review round 2 — brief §Step 6: `processRoundCallable` must not
   * let a teacher settle a household that hasn't submitted a decision for
   * the round yet, distinct from `settleRound`'s own `decision === null` →
   * `REDUCE_EXPENSES` auto-fallback (§13.13), which is for a shortfall only
   * discovered mid-settlement despite a decision existing (or an explicit
   * force). See `processRound.ts`'s `ProcessRoundInput.forceSettle` doc
   * comment for the full reasoning.
   */
  describe('submission gate (Task 11 review round 2)', () => {
    it('rejects settlement when no decision has been submitted for this round and forceSettle is not set', async () => {
      const deps = makeDeps({ readHouseholdDecision: vi.fn().mockResolvedValue(null) })
      await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' }))
        .rejects.toThrow('HouseholdDecision not submitted for this round')
      expect(deps.settleRoundFn).not.toHaveBeenCalled()
      expect(deps.commitRoundSettlement).not.toHaveBeenCalled()
    })

    it('allows settlement with no submitted decision when forceSettle is true and records forcedSettlement=true', async () => {
      const deps = makeDeps({ readHouseholdDecision: vi.fn().mockResolvedValue(null) })
      const result = await processRound(deps, {
        lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: true,
      })
      expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
      expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ decision: null }))
      expect(deps.commitRoundSettlement).toHaveBeenCalledWith(expect.objectContaining({
        forcedSettlement: true,
      }))
    })

    it('records forcedSettlement=false when decision was submitted', async () => {
      const deps = makeDeps()
      const result = await processRound(deps, {
        lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: false,
      })
      expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
      expect(deps.commitRoundSettlement).toHaveBeenCalledWith(expect.objectContaining({
        forcedSettlement: false,
      }))
    })
  })

  describe('duplicate settlement safety', () => {
    it('returns ALREADY_SETTLED and does not publish realtime state when commitRoundSettlement reports ALREADY_SETTLED', async () => {
      const currentHouseholdState: HouseholdState = { ...household, roundIndex: 3 }
      const deps = makeDeps({
        commitRoundSettlement: vi.fn().mockResolvedValue({
          status: 'ALREADY_SETTLED',
          householdState: currentHouseholdState,
        }),
      })

      const result = await processRound(deps, {
        lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a',
      })

      expect(result).toEqual({
        status: 'ALREADY_SETTLED',
        householdState: currentHouseholdState,
      })
      expect(deps.publishRealtimeState).not.toHaveBeenCalled()
    })
  })
})

// -----------------------------------------------------------------------------
// Exercises `readLessonRunConfigWithAdminSdk` directly (Important I3, final
// whole-branch review) — the Admin SDK wiring has no injected dependency
// seam (it calls getFirestore() directly, matching every other
// *WithAdminSdk function in this codebase), so a module-level
// vi.mock('firebase-admin/firestore', ...) is the established way to test
// it without a real emulator, same precedent as
// market/processBatch.publishRealtimeState.test.ts.
// -----------------------------------------------------------------------------
const firestoreDocs = new Map<string, Record<string, unknown>>()

// -----------------------------------------------------------------------------
// A minimal RTDB fake that actually understands `.update()`'s
// slash-in-key partial-path semantics — unlike
// `processRound.publishRealtimeState.test.ts`'s flat `{path, data}` log
// (sufficient for that file's COMMON_CONDITIONS-only assertions), Task 9's
// "advanced updates only its runtime entry and preserves sibling
// households" requirement can only be proven against a store that actually
// merges `households/${id}` into the existing `households` map rather than
// replacing it — real RTDB `.update()` treats a `/`-containing key as
// addressing that nested path, not a literal top-level key.
// -----------------------------------------------------------------------------
const rtdbStore: Record<string, unknown> = {}

const setAtPath = (root: Record<string, unknown>, path: string, value: unknown): void => {
  const segments = path.split('/').filter(Boolean)
  let node = root
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]
    const next = node[key]
    if (typeof next !== 'object' || next === null) node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[segments[segments.length - 1]] = value
}

const getAtPath = (root: Record<string, unknown>, path: string): unknown => {
  const segments = path.split('/').filter(Boolean)
  let node: unknown = root
  for (const key of segments) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

vi.mock('firebase-admin/database', () => ({
  getDatabase: () => ({
    ref: (basePath: string) => ({
      update: async (data: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(data)) {
          setAtPath(rtdbStore, `${basePath}/${key}`, value)
        }
      },
    }),
  }),
}))

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: firestoreDocs.has(path), data: () => firestoreDocs.get(path) }),
    }),
    // Task 4 fix test support: `commitRoundSettlementWithAdminSdk` reads/writes
    // via `db.runTransaction`, not a bare `doc().get()` — a minimal fake tx
    // that reuses the same `firestoreDocs` map/`doc()` shape above so
    // `tx.get(db.doc(path))` and `tx.set(db.doc(path), data)` behave like the
    // real Admin SDK closely enough for this file's own read/write calls.
    runTransaction: async (fn: (tx: {
      get: (docRef: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (docRef: { path: string }, data: Record<string, unknown>) => void
    }) => unknown) => {
      const tx = {
        get: async (docRef: { path: string }) => ({
          exists: firestoreDocs.has(docRef.path),
          data: () => firestoreDocs.get(docRef.path),
        }),
        set: (docRef: { path: string }, data: Record<string, unknown>) => {
          firestoreDocs.set(docRef.path, data)
        },
      }
      return fn(tx)
    },
  }),
}))

beforeEach(() => {
  firestoreDocs.clear()
  for (const key of Object.keys(rtdbStore)) delete rtdbStore[key]
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('readLessonRunConfigWithAdminSdk (Important I3)', () => {
  const homeEconomicsSnapshot = {
    households: [], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
    publicSupportPrograms: [], roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
    taxAndSocialInsuranceModelVersion: 1,
    economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
    borrowingAllowed: false, goalPackage: 'OVERALL_BALANCE',
    evaluationWeights: {
      lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
    },
  }

  /**
   * The core I3 regression test: a LessonRun document missing `orgId`
   * entirely must THROW during settlement, not silently coerce to `''` and
   * proceed to write an unreadable RTDB node downstream.
   */
  it('throws when the LessonRun document has no orgId at all', async () => {
    firestoreDocs.set('lessonRuns/run-1', {
      randomSeed: 'seed-x', restoreGeneration: 0, templateSnapshot: { homeEconomics: homeEconomicsSnapshot },
    })
    const { readLessonRunConfigWithAdminSdk } = await import('./processRound')
    await expect(readLessonRunConfigWithAdminSdk('run-1'))
      .rejects.toThrow('LessonRun is missing orgId — cannot settle round safely.')
  })

  it('throws when orgId is an empty string', async () => {
    firestoreDocs.set('lessonRuns/run-1', {
      orgId: '', randomSeed: 'seed-x', restoreGeneration: 0, templateSnapshot: { homeEconomics: homeEconomicsSnapshot },
    })
    const { readLessonRunConfigWithAdminSdk } = await import('./processRound')
    await expect(readLessonRunConfigWithAdminSdk('run-1'))
      .rejects.toThrow('LessonRun is missing orgId — cannot settle round safely.')
  })

  it('succeeds and returns the real orgId when present', async () => {
    firestoreDocs.set('lessonRuns/run-1', {
      orgId: 'org-real', randomSeed: 'seed-x', restoreGeneration: 0, templateSnapshot: { homeEconomics: homeEconomicsSnapshot },
    })
    const { readLessonRunConfigWithAdminSdk } = await import('./processRound')
    const config = await readLessonRunConfigWithAdminSdk('run-1')
    expect(config.orgId).toBe('org-real')
  })
})

/**
 * Task 4 review fix — the `ALREADY_SETTLED` race-guard branch inside
 * `commitRoundSettlementWithAdminSdk` re-reads the household doc directly
 * from Firestore. Before this fix it cast that raw read straight to
 * `HouseholdState`, bypassing `resolveStoredHouseholdState()` — so a legacy
 * `COMMON_CONDITIONS` document with no stored `profileId` (written before
 * `profileId` became required) would come back TYPED as complete but
 * ACTUALLY missing `profileId` at runtime. This exercises the real Admin SDK
 * implementation (not a mocked `commitRoundSettlement` dep, unlike the
 * `processRound` describe block above) against exactly that legacy shape.
 */
describe('commitRoundSettlementWithAdminSdk — ALREADY_SETTLED race-guard normalization (Task 4 fix)', () => {
  const profile = {
    householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
    annualLivingExpensesYen: 3000000, cashSavingsYen: 500000,
    family: '配偶者・子2人', housing: '賃貸マンション', lifeGoal: '住宅購入と教育資金',
    lifeStage: 'CHILD_REARING' as const, eventProbabilityOverrides: {}, internalRiskFactors: {},
  }
  const homeEconomicsContent = {
    households: [profile], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
    publicSupportPrograms: [], roundYears: 5 as const, courseFormat: 'COMMON_CONDITIONS' as const,
    taxAndSocialInsuranceModelVersion: 1,
    economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
    borrowingAllowed: false, goalPackage: 'OVERALL_BALANCE' as const,
    evaluationWeights: {
      lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
    },
  }
  const settleResult: SettleRoundResult = {
    newHouseholdState: {
      householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 600000,
      assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'CHILD_REARING', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
    },
    occurredEventIds: [], incomeYen: 4800000, expensesYen: 3000000,
    netCashFlowYen: 1800000, shortfallYen: 0, insuranceBenefitsYen: 0,
    shortfallOptionsConsidered: [],
  }

  it('resolves the sole COMMON_CONDITIONS profile for a legacy household doc with no stored profileId, instead of returning it undefined', async () => {
    // A round already settled by a concurrent/duplicate call: the doc's
    // roundIndex (3) no longer matches expectedPriorRoundIndex (2), which is
    // exactly what makes the race-guard fire. It has NO `profileId` field at
    // all — the pre-migration legacy shape.
    const legacyStoredHousehold = {
      householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', cashYen: 600000,
      assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'CHILD_REARING', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
    }
    firestoreDocs.set('lessonRuns/run-1/households/case-b', legacyStoredHousehold)

    const { commitRoundSettlementWithAdminSdk } = await import('./processRound')
    const result = await commitRoundSettlementWithAdminSdk({
      lessonRunId: 'run-1', householdId: 'case-b', orgId: 'org-1',
      expectedPriorRoundIndex: 2, result: settleResult, actorId: 'teacher-a',
      forcedSettlement: false, homeEconomicsContent,
    })

    expect(result.status).toBe('ALREADY_SETTLED')
    if (result.status !== 'ALREADY_SETTLED') throw new Error('unreachable')
    // The bug this test guards against: without routing through
    // `resolveStoredHouseholdState()`, `profileId` would be `undefined` here
    // despite the `HouseholdState` type claiming it's always present.
    expect(result.householdState.profileId).toBe('case-b')
  })

  it('fails closed for a legacy household doc with no stored profileId under an advanced course format', async () => {
    const advancedContent = { ...homeEconomicsContent, courseFormat: 'ROLE_VARIANT' as const }
    const legacyStoredHousehold = {
      householdId: 'household-runtime-1', lessonRunId: 'run-1', teamId: 'team-a', cashYen: 600000,
      assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'CHILD_REARING', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
    }
    firestoreDocs.set('lessonRuns/run-1/households/household-runtime-1', legacyStoredHousehold)

    const { commitRoundSettlementWithAdminSdk } = await import('./processRound')
    await expect(commitRoundSettlementWithAdminSdk({
      lessonRunId: 'run-1', householdId: 'household-runtime-1', orgId: 'org-1',
      expectedPriorRoundIndex: 2, result: settleResult, actorId: 'teacher-a',
      forcedSettlement: false, homeEconomicsContent: advancedContent,
    })).rejects.toThrow(/profileId/)
  })
})

/**
 * Task 9 — `publishRealtimeStateWithAdminSdk`'s course-format branch for
 * `lessonRunTeamState`. COMMON_CONDITIONS keeps writing `.household`
 * unchanged (Task 15, exercised by `processRound.publishRealtimeState.test.ts`);
 * the 3 advanced formats instead write a scoped `households/${householdId}`
 * update that must never clobber a sibling household's already-published
 * entry on the same team node — this is the core Task 9 regression the
 * `rtdbStore` path-aware fake above exists to prove.
 */
describe('publishRealtimeStateWithAdminSdk — advanced course-format branch (Task 9)', () => {
  const advancedProfile = {
    householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
    annualLivingExpensesYen: 3000000, cashSavingsYen: 500000,
    family: '配偶者・子2人', housing: '賃貸マンション', lifeGoal: '住宅購入と教育資金',
    lifeStage: 'CHILD_REARING' as const, eventProbabilityOverrides: {}, internalRiskFactors: {},
  }
  const advancedHomeEconomics = {
    households: [advancedProfile], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
    publicSupportPrograms: [], roundYears: 5 as const, courseFormat: 'MULTI_PERSON_PER_TEAM' as const,
    taxAndSocialInsuranceModelVersion: 1,
    economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
    borrowingAllowed: false, goalPackage: 'OVERALL_BALANCE' as const,
    evaluationWeights: {
      lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
    },
  }
  const advancedSettleResult: SettleRoundResult = {
    newHouseholdState: {
      householdId: 'household-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 600000,
      assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
      lifeStage: 'CHILD_REARING', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
    },
    occurredEventIds: [], incomeYen: 4800000, expensesYen: 3000000,
    netCashFlowYen: 1800000, shortfallYen: 0, insuranceBenefitsYen: 0,
    shortfallOptionsConsidered: [],
  }
  const control = {
    courseFormat: 'MULTI_PERSON_PER_TEAM', assignmentRevision: 1, synchronizedRoundIndex: 3,
    roundStatus: 'OPEN', activeOperationId: null, updatedAtServerMillis: 1,
  }

  const siblingEntry = {
    householdId: 'household-a', profile: { householdId: 'case-a' }, state: { householdId: 'household-a', roundIndex: 3 },
    submittedRoundIndex: null,
  }

  it('throws when HouseholdRuntimeControl has not been published yet', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await expect(publishRealtimeStateWithAdminSdk({
      lessonRunId: 'run-1', orgId: 'org-1', homeEconomics: advancedHomeEconomics, profile: advancedProfile,
      decision: null, result: advancedSettleResult,
    })).rejects.toThrow('HouseholdRuntimeControl not found')
  })

  it('writes a scoped households/{householdId} update and preserves an existing sibling entry + householdOrder', async () => {
    firestoreDocs.set('lessonRuns/run-1/householdRuntime/control', control)
    // Simulate an initial publish (afterStatusTransition, Task 9) already
    // having written household-a's entry and the team-wide householdOrder.
    setAtPath(rtdbStore, 'lessonRunTeamState/run-1/team-a/households/household-a', siblingEntry)
    setAtPath(rtdbStore, 'lessonRunTeamState/run-1/team-a/householdOrder', ['household-a', 'household-b'])

    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({
      lessonRunId: 'run-1', orgId: 'org-1', homeEconomics: advancedHomeEconomics, profile: advancedProfile,
      decision: null, result: advancedSettleResult,
    })

    const teamNode = getAtPath(rtdbStore, 'lessonRunTeamState/run-1/team-a') as Record<string, unknown>
    expect(teamNode.orgId).toBe('org-1')
    expect(teamNode.courseFormat).toBe('MULTI_PERSON_PER_TEAM')
    expect(teamNode.synchronizedRoundIndex).toBe(3)
    expect(teamNode.roundStatus).toBe('OPEN')

    const households = teamNode.households as Record<string, unknown>
    // The just-settled household's entry was written...
    expect((households['household-b'] as { householdId: string }).householdId).toBe('household-b')
    // ...and the sibling's already-published entry survived untouched.
    expect(households['household-a']).toEqual(siblingEntry)
    // householdOrder (set once by the initial publish) was never touched by this scoped update.
    expect(teamNode.householdOrder).toEqual(['household-a', 'household-b'])
  })

  it('sets submittedRoundIndex to null for the just-settled household (it has not yet submitted for its new current round)', async () => {
    firestoreDocs.set('lessonRuns/run-1/householdRuntime/control', control)

    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({
      lessonRunId: 'run-1', orgId: 'org-1', homeEconomics: advancedHomeEconomics, profile: advancedProfile,
      decision: null, result: advancedSettleResult,
    })

    const entry = getAtPath(rtdbStore, 'lessonRunTeamState/run-1/team-a/households/household-b') as { submittedRoundIndex: number | null }
    expect(entry.submittedRoundIndex).toBeNull()
  })

  it('never writes a whole-node household field for advanced formats — no bare .household key', async () => {
    firestoreDocs.set('lessonRuns/run-1/householdRuntime/control', control)

    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({
      lessonRunId: 'run-1', orgId: 'org-1', homeEconomics: advancedHomeEconomics, profile: advancedProfile,
      decision: null, result: advancedSettleResult,
    })

    const teamNode = getAtPath(rtdbStore, 'lessonRunTeamState/run-1/team-a') as Record<string, unknown>
    expect(teamNode.household).toBeUndefined()
  })
})
