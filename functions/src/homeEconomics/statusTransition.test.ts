import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import { prepareStatusTransition, afterStatusTransition, type HouseholdRuntimeControl } from './statusTransition'
import type { FirestoreTx } from '../lessonRuns/phases/transitionPhase'
import type { HouseholdAssignmentConfig } from './householdAssignmentRepository'
import type { HouseholdAssignmentEntry } from './householdAssignment'

// -----------------------------------------------------------------------------
// `afterStatusTransition` (Task 9) is self-sufficient — it calls
// getFirestore()/getDatabase() directly rather than taking an injected
// dependency seam, matching every other `*WithAdminSdk`-style function in
// this codebase (see its own JSDoc). Module-level mocks are the established
// way to test that without a real emulator (same precedent as
// assignedHousehold.test.ts's `ensureAssignedHouseholdStateWithAdminSdk`
// tests, which this hook calls internally).
// -----------------------------------------------------------------------------
const docs = new Map<string, Record<string, unknown>>()
const collections = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
const rtdbUpdates: Array<{ path: string; data: Record<string, unknown> }> = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      path,
      get: async () => ({
        exists: docs.has(path),
        data: () => docs.get(path),
        get: (field: string) => (docs.get(path) as Record<string, unknown> | undefined)?.[field],
      }),
    }),
    collection: (path: string) => ({
      get: async () => ({
        docs: (collections.get(path) ?? []).map((entry) => ({ id: entry.id, data: () => entry.data })),
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
      set: (ref: { path: string }, data: Record<string, unknown>) => { docs.set(ref.path, data) },
    }),
  }),
}))

vi.mock('firebase-admin/database', () => ({
  getDatabase: () => ({
    ref: (path: string) => ({
      update: async (data: Record<string, unknown>) => { rtdbUpdates.push({ path, data }) },
    }),
  }),
}))

beforeEach(() => {
  docs.clear()
  collections.clear()
  rtdbUpdates.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

const profileA: HouseholdProfile = {
  householdId: 'profile-a', age: 30, householdIncomeYen: 5000000, annualLivingExpensesYen: 3000000,
  cashSavingsYen: 1000000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄', lifeStage: 'INDEPENDENT',
  eventProbabilityOverrides: {}, internalRiskFactors: {},
}
const profileB: HouseholdProfile = {
  householdId: 'profile-b', age: 40, householdIncomeYen: 7000000, annualLivingExpensesYen: 4000000,
  cashSavingsYen: 2000000, family: '配偶者・子1人', housing: '持ち家', lifeGoal: '教育資金', lifeStage: 'CHILD_REARING',
  eventProbabilityOverrides: {}, internalRiskFactors: {},
}

/**
 * `set` throws unconditionally: `prepareStatusTransition` must be a pure
 * read-only analysis that returns writes for its caller to apply, never
 * calling `tx.set` itself (per the brief and `transitionPhase.ts`'s
 * `TransitionPhaseDeps.prepareStatusTransition` JSDoc) — any test that
 * accidentally exercises a write path fails loudly instead of silently
 * passing.
 */
const makeFakeTx = (
  docs: Record<string, Record<string, unknown>>,
  collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {},
): FirestoreTx => ({
  get: async (path: string) => ({ exists: path in docs, data: () => docs[path] }),
  getCollection: async (path: string) => collections[path] ?? [],
  set: () => { throw new Error('prepareStatusTransition must not call tx.set itself') },
})

const teamSetFingerprintOf = async (teamIds: string[]): Promise<string> => {
  const { teamSetFingerprint } = await import('./householdAssignment')
  return teamSetFingerprint(teamIds)
}

const buildRun = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  subject: 'HOME_ECONOMICS',
  startedAt: null,
  templateSnapshot: {
    homeEconomics: {
      courseFormat: 'ROLE_VARIANT',
      households: [profileA, profileB],
    },
  },
  ...overrides,
})

const entry = (
  teamId: string, profileId: string, slotKey: string, displayOrder: number,
): HouseholdAssignmentEntry => ({
  householdId: `${teamId}:${slotKey}`, teamId, profileId, slotKey, displayOrder, assignmentSource: 'AUTO',
})

describe('prepareStatusTransition', () => {
  it('returns null for a non-RUNNING target status', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'PAUSED', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('returns null for a Social Studies lesson (subject !== HOME_ECONOMICS)', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ subject: 'SOCIAL_STUDIES' }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('returns null for COMMON_CONDITIONS Home Economics (no per-team assignment to freeze)', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS', households: [profileA] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  // Regression: PAUSED -> RUNNING (a resume) must never re-freeze or reset
  // the runtime control — this is exactly the `startedAt != null` signal
  // transitionPhase.ts itself uses to decide "is this the first RUNNING
  // start".
  it('returns null when run.startedAt is already set (PAUSED -> RUNNING resume, not a first start)', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ startedAt: '2026-08-15T09:00:00Z' }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('throws when no HouseholdAssignmentConfig has ever been prepared', async () => {
    const tx = makeFakeTx({})
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('HouseholdAssignment has not been prepared')
  })

  it('throws when the config is stale (team set changed since it was last prepared)', async () => {
    const fingerprint = await teamSetFingerprintOf(['team-a'])
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds: ['team-a', 'team-b'] },
      },
      { 'lessonRuns/run-1/householdAssignment/config/entries': [] },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('HouseholdAssignment is stale')
  })

  it('throws when validation is not READY (e.g. entry count mismatch)', async () => {
    const fingerprint = await teamSetFingerprintOf(['team-a', 'team-b'])
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds: ['team-a', 'team-b'] },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('HouseholdAssignment is not ready to start')
  })

  it('throws when an entry references a team that no longer exists', async () => {
    const fingerprint = await teamSetFingerprintOf(['team-a'])
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['ghost-team:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds: ['team-a'] },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'ghost-team:profile-a', data: entry('ghost-team', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [profileA] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('references a team that no longer exists')
  })

  it('throws for STAGE_SPLIT when a lifeStage has no covering entry', async () => {
    const teamIds = ['team-a', 'team-b']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'STAGE_SPLIT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a', 'team-b:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    // Both teams manually reassigned to profile-a (INDEPENDENT) — profile-b's
    // CHILD_REARING stage ends up with zero covering entries, even though
    // the plain entry-count check alone would still pass.
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
          { id: 'team-b:profile-a', data: entry('team-b', 'profile-a', 'profile-a', 1) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'STAGE_SPLIT', households: [profileA, profileB] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('missing coverage for lifeStage')
  })

  it('throws for MULTI_PERSON_PER_TEAM when a team does not have the exact full profile set', async () => {
    const teamIds = ['team-a', 'team-b']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'MULTI_PERSON_PER_TEAM', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint,
      entryIds: ['team-a:0:profile-a', 'team-a:1:profile-b', 'team-b:0:profile-a', 'team-b:1:profile-a'],
      entriesDigest: 'digest', lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:0:profile-a', data: entry('team-a', 'profile-a', '0:profile-a', 0) as unknown as Record<string, unknown> },
          { id: 'team-a:1:profile-b', data: entry('team-a', 'profile-b', '1:profile-b', 1) as unknown as Record<string, unknown> },
          // team-b is missing profile-b and has profile-a twice instead —
          // same total entry count, so the plain count check alone passes.
          { id: 'team-b:0:profile-a', data: entry('team-b', 'profile-a', '0:profile-a', 2) as unknown as Record<string, unknown> },
          { id: 'team-b:1:profile-a-dup', data: entry('team-b', 'profile-a', '1:profile-a-dup', 3) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'MULTI_PERSON_PER_TEAM', households: [profileA, profileB] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('does not have the full profile set')
  })

  it('returns FROZEN config write + initial HouseholdRuntimeControl write on success, without calling tx.set itself', async () => {
    const teamIds = ['team-a', 'team-b']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 3,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a', 'team-b:profile-b'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
          { id: 'team-b:profile-b', data: entry('team-b', 'profile-b', 'profile-b', 0) as unknown as Record<string, unknown> },
        ],
      },
    )

    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-9', nowValue: 'now',
    })

    expect(result).not.toBeNull()
    expect(result!.writes).toHaveLength(2)

    const configWrite = result!.writes.find((write) => write.path === 'lessonRuns/run-1/householdAssignment/config')
    expect(configWrite?.data).toMatchObject({
      state: 'FROZEN', frozenByUid: 'teacher-9', assignmentRevision: 3, courseFormat: 'ROLE_VARIANT',
    })
    expect(typeof configWrite?.data.frozenAtServerMillis).toBe('number')

    const controlWrite = result!.writes.find((write) => write.path === 'lessonRuns/run-1/householdRuntime/control')
    expect(controlWrite?.data).toMatchObject({
      courseFormat: 'ROLE_VARIANT', assignmentRevision: 3, synchronizedRoundIndex: 0,
      roundStatus: 'OPEN', activeOperationId: null,
    } satisfies Partial<HouseholdRuntimeControl>)
    expect(typeof controlWrite?.data.updatedAtServerMillis).toBe('number')
  })

  it('returns null (no-op) if the assignment is already FROZEN, rather than re-freezing', async () => {
    const teamIds = ['team-a']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'FROZEN', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1, frozenByUid: 'teacher-1', frozenAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
        ],
      },
    )
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [profileA] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })
})

describe('prepareStatusTransition (REFLECTION, Task 12)', () => {
  const frozenConfig: HouseholdAssignmentConfig = {
    courseFormat: 'ROLE_VARIANT', state: 'FROZEN', validationStatus: 'READY', assignmentRevision: 1,
    teamSetFingerprint: 'fp', entryIds: ['team-a:profile-a', 'team-b:profile-b'], entriesDigest: 'digest',
    lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1, frozenByUid: 'teacher-1', frozenAtServerMillis: 1,
  }
  const cleanControl: HouseholdRuntimeControl = {
    courseFormat: 'ROLE_VARIANT', assignmentRevision: 1, synchronizedRoundIndex: 6,
    roundStatus: 'OPEN', activeOperationId: null, updatedAtServerMillis: 1,
  }
  const householdState = (overrides: Record<string, unknown> = {}) => ({
    householdId: 'x', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'profile-a',
    cashYen: 1000000, assetHoldingsYen: { DOMESTIC_STOCK: 500000 }, activeInsuranceContracts: {},
    activeLiabilities: {}, lifeStage: 'INDEPENDENT', roundIndex: 6, goalDelayedRounds: 1,
    updatedAtServerMillis: 1, ...overrides,
  })

  const baseDocs = () => ({
    'lessonRuns/run-1/householdAssignment/config': frozenConfig as unknown as Record<string, unknown>,
    'lessonRuns/run-1/householdRuntime/control': cleanControl as unknown as Record<string, unknown>,
  })
  const baseCollections = () => ({
    'lessonRuns/run-1/householdAssignment/config/entries': [
      { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
      { id: 'team-b:profile-b', data: entry('team-b', 'profile-b', 'profile-b', 0) as unknown as Record<string, unknown> },
    ],
    'lessonRuns/run-1/households': [
      { id: 'team-a:profile-a', data: householdState({ householdId: 'team-a:profile-a', teamId: 'team-a', profileId: 'profile-a', goalDelayedRounds: 0 }) },
      { id: 'team-b:profile-b', data: householdState({ householdId: 'team-b:profile-b', teamId: 'team-b', profileId: 'profile-b', goalDelayedRounds: 2, roundIndex: 6 }) },
    ],
    'lessonRuns/run-1/teams': [
      { id: 'team-a', data: { displayName: 'チームA' } },
      { id: 'team-b', data: { displayName: 'チームB' } },
    ],
    // Top-level, unscoped-by-lessonRunId collection —
    // `hasUnresolvedBulkSettlementOperationInTransaction` reads this whole
    // collection through `tx.getCollection` (the same fake used for every
    // other collection above) and filters by `lessonRunId`/`status` itself,
    // so it is modeled here exactly like any other `tx.getCollection` path
    // rather than through a separate `getFirestore().collection().where()`
    // mock.
    'householdBulkSettlementOperations': [] as Array<{ id: string; data: Record<string, unknown> }>,
  })
  const reflectionRun = buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [profileA, profileB] } } })

  it('returns null for a Social Studies lesson (subject !== HOME_ECONOMICS)', async () => {
    const tx = makeFakeTx(baseDocs(), baseCollections())
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun({ subject: 'SOCIAL_STUDIES' }), targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('returns null for COMMON_CONDITIONS Home Economics (no per-team comparison to publish)', async () => {
    const tx = makeFakeTx(baseDocs(), baseCollections())
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS', households: [profileA] } } }),
      targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('throws when roundStatus is SETTLING', async () => {
    const tx = makeFakeTx(
      { ...baseDocs(), 'lessonRuns/run-1/householdRuntime/control': { ...cleanControl, roundStatus: 'SETTLING' } as unknown as Record<string, unknown> },
      baseCollections(),
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('SETTLING')
  })

  it('throws when there is an active operation lock', async () => {
    const tx = makeFakeTx(
      { ...baseDocs(), 'lessonRuns/run-1/householdRuntime/control': { ...cleanControl, activeOperationId: 'op-1' } as unknown as Record<string, unknown> },
      baseCollections(),
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('locked')
  })

  it('throws when synchronizedRoundIndex is 0 (no completed round yet)', async () => {
    const tx = makeFakeTx(
      { ...baseDocs(), 'lessonRuns/run-1/householdRuntime/control': { ...cleanControl, synchronizedRoundIndex: 0 } as unknown as Record<string, unknown> },
      baseCollections(),
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('nothing to compare')
  })

  it('throws when an unresolved bulk settlement operation exists for this lesson run', async () => {
    const collectionsWithUnresolvedOp = {
      ...baseCollections(),
      householdBulkSettlementOperations: [
        { id: 'op-1', data: { operationId: 'op-1', lessonRunId: 'run-1', status: 'RUNNING' } },
      ],
    }
    const tx = makeFakeTx(baseDocs(), collectionsWithUnresolvedOp)
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('unresolved bulk')
  })

  it('does not reject on a RESOLVED (COMPLETED) bulk operation for this lesson run', async () => {
    const collectionsWithResolvedOp = {
      ...baseCollections(),
      householdBulkSettlementOperations: [
        { id: 'op-1', data: { operationId: 'op-1', lessonRunId: 'run-1', status: 'COMPLETED' } },
      ],
    }
    const tx = makeFakeTx(baseDocs(), collectionsWithResolvedOp)
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).not.toBeNull()
  })

  // Regression for the transactional-consistency fix: this collection is
  // top-level and unscoped by lessonRunId, so an unresolved operation
  // belonging to a DIFFERENT lesson run must not trip this lesson's gate —
  // proves the `lessonRunId` filter is actually applied after reading the
  // whole collection through `tx`.
  it('does not reject on an unresolved bulk operation belonging to a different lesson run', async () => {
    const collectionsWithOtherRunOp = {
      ...baseCollections(),
      householdBulkSettlementOperations: [
        { id: 'op-1', data: { operationId: 'op-1', lessonRunId: 'run-OTHER', status: 'RUNNING' } },
      ],
    }
    const tx = makeFakeTx(baseDocs(), collectionsWithOtherRunOp)
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).not.toBeNull()
  })


  it('throws when households are not aligned on the same round index', async () => {
    const misaligned = baseCollections()
    misaligned['lessonRuns/run-1/households'] = [
      { id: 'team-a:profile-a', data: householdState({ householdId: 'team-a:profile-a', roundIndex: 6 }) },
      { id: 'team-b:profile-b', data: householdState({ householdId: 'team-b:profile-b', teamId: 'team-b', profileId: 'profile-b', roundIndex: 5 }) },
    ]
    const tx = makeFakeTx(baseDocs(), misaligned)
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('not aligned')
  })

  it('returns a single write to householdFinalComparisonPath with a privacy-safe comparison, without calling tx.set itself', async () => {
    const tx = makeFakeTx(baseDocs(), baseCollections())
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: reflectionRun, targetStatus: 'REFLECTION', actorId: 'teacher-1', nowValue: 'now',
    })

    expect(result).not.toBeNull()
    expect(result!.writes).toHaveLength(1)
    expect(result!.writes[0].path).toBe('lessonRuns/run-1/householdFinalComparison/result')

    const comparison = result!.writes[0].data as unknown as {
      courseFormat: string; finalRoundCount: number; teams: Array<{ teamDisplayName: string; households: Array<Record<string, unknown>> }>
    }
    expect(comparison.courseFormat).toBe('ROLE_VARIANT')
    expect(comparison.finalRoundCount).toBe(6) // control.synchronizedRoundIndex, not any household's own roundIndex
    expect(comparison.teams.map((t) => t.teamDisplayName)).toEqual(['チームA', 'チームB'])

    const serialized = JSON.stringify(comparison)
    expect(serialized).not.toContain('team-a:profile-a')
    expect(serialized).not.toContain('team-b:profile-b')
    expect(serialized).not.toContain('internalRiskFactors')
    expect(serialized).not.toContain('eventProbabilityOverrides')
    expect(serialized).not.toContain('lessonRunId')
  })
})

describe('afterStatusTransition (Task 9)', () => {
  const frozenConfig: HouseholdAssignmentConfig = {
    courseFormat: 'MULTI_PERSON_PER_TEAM', state: 'FROZEN', validationStatus: 'READY', assignmentRevision: 1,
    teamSetFingerprint: 'fp', entryIds: [], entriesDigest: 'digest',
    lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1, frozenByUid: 'teacher-1', frozenAtServerMillis: 1,
  }
  const control: HouseholdRuntimeControl = {
    courseFormat: 'MULTI_PERSON_PER_TEAM', assignmentRevision: 1, synchronizedRoundIndex: 0,
    roundStatus: 'OPEN', activeOperationId: null, updatedAtServerMillis: 1,
  }
  const multiPersonRun = {
    subject: 'HOME_ECONOMICS', startedAt: null, orgId: 'org-1',
    templateSnapshot: {
      homeEconomics: { courseFormat: 'MULTI_PERSON_PER_TEAM', households: [profileA, profileB], goalPackage: 'EMERGENCY_FUND' },
    },
  }

  const setUpMultiPersonTeam = () => {
    docs.set('lessonRuns/run-1', multiPersonRun)
    docs.set('lessonRuns/run-1/householdAssignment/config', frozenConfig as unknown as Record<string, unknown>)
    docs.set('lessonRuns/run-1/householdRuntime/control', control as unknown as Record<string, unknown>)
    collections.set('lessonRuns/run-1/householdAssignment/config/entries', [
      { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
      { id: 'team-a:profile-b', data: entry('team-a', 'profile-b', 'profile-b', 1) as unknown as Record<string, unknown> },
    ])
  }

  it('does nothing for a non-RUNNING target status', async () => {
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'PAUSED', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('does nothing for a Social Studies lesson', async () => {
    docs.set('lessonRuns/run-1', { ...multiPersonRun, subject: 'SOCIAL_STUDIES' })
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('does nothing for COMMON_CONDITIONS Home Economics', async () => {
    docs.set('lessonRuns/run-1', {
      ...multiPersonRun,
      templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS', households: [profileA] } },
    })
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('does nothing when the assignment is not (yet) FROZEN', async () => {
    docs.set('lessonRuns/run-1', multiPersonRun)
    docs.set('lessonRuns/run-1/householdAssignment/config', { ...frozenConfig, state: 'DRAFT' } as unknown as Record<string, unknown>)
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('does nothing when the LessonRun document does not exist', async () => {
    await afterStatusTransition({ lessonRunId: 'ghost-run', targetStatus: 'RUNNING', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('ensures a HouseholdState exists for every frozen entry and publishes an initial team node for MULTI_PERSON_PER_TEAM (both households on the one team, one update)', async () => {
    setUpMultiPersonTeam()

    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })

    expect(docs.get('lessonRuns/run-1/households/team-a:profile-a')).toBeDefined()
    expect(docs.get('lessonRuns/run-1/households/team-a:profile-b')).toBeDefined()

    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    expect(teamUpdate).toBeDefined()
    expect(teamUpdate!.data.orgId).toBe('org-1')
    expect(teamUpdate!.data.courseFormat).toBe('MULTI_PERSON_PER_TEAM')
    expect(teamUpdate!.data.synchronizedRoundIndex).toBe(0)
    expect(teamUpdate!.data.roundStatus).toBe('OPEN')
    expect(teamUpdate!.data.householdOrder).toEqual(['team-a:profile-a', 'team-a:profile-b'])

    const households = teamUpdate!.data.households as Record<string, { householdId: string; submittedRoundIndex: number | null }>
    expect(Object.keys(households).sort()).toEqual(['team-a:profile-a', 'team-a:profile-b'])
    expect(households['team-a:profile-a'].submittedRoundIndex).toBeNull()
    expect(households['team-a:profile-b'].submittedRoundIndex).toBeNull()
  })

  it('never leaks internalRiskFactors/eventProbabilityOverrides in the initial published team node', async () => {
    setUpMultiPersonTeam()
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })
    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    expect(JSON.stringify(teamUpdate!.data)).not.toContain('internalRiskFactors')
    expect(JSON.stringify(teamUpdate!.data)).not.toContain('eventProbabilityOverrides')
  })

  /**
   * Task 3's `prepareStatusTransition` requirement: this post-commit hook
   * must still fire (and behave correctly) on a deduplicated replay of the
   * SAME first-RUNNING request — e.g. a retried Callable. Ensuring an
   * already-existing HouseholdState is a no-op (Task 4), and re-publishing
   * the same deterministic initial view via RTDB `.update()` is a no-op in
   * effect the second time.
   */
  it('is safe to re-invoke on a deduplicated replay (deduplicated: true) — same result, no throw', async () => {
    setUpMultiPersonTeam()
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })
    rtdbUpdates.length = 0

    await expect(afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: true })).resolves.toBeUndefined()

    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    expect(teamUpdate).toBeDefined()
    const households = teamUpdate!.data.households as Record<string, unknown>
    expect(Object.keys(households).sort()).toEqual(['team-a:profile-a', 'team-a:profile-b'])
  })
})

describe('afterStatusTransition (REFLECTION, Task 12)', () => {
  const roleVariantRun = {
    subject: 'HOME_ECONOMICS', startedAt: '2026-08-01T00:00:00Z', orgId: 'org-1',
    templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [profileA, profileB] } },
  }
  const comparison = {
    courseFormat: 'ROLE_VARIANT', finalRoundCount: 6, publishedAtMillis: 1000,
    teams: [{ teamDisplayName: 'チームA', households: [{ profileId: 'profile-a', profile: profileA, cashYen: 1, totalAssetsYen: 1, totalLiabilitiesYen: 0, goalDelayedRounds: 0, lifeGoalAchievementScore: 100 }] }],
  }

  it('does nothing for a Social Studies lesson', async () => {
    docs.set('lessonRuns/run-1', { ...roleVariantRun, subject: 'SOCIAL_STUDIES' })
    docs.set('lessonRuns/run-1/householdFinalComparison/result', comparison as unknown as Record<string, unknown>)
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('does nothing for COMMON_CONDITIONS Home Economics', async () => {
    docs.set('lessonRuns/run-1', {
      ...roleVariantRun,
      templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS', households: [profileA] } },
    })
    docs.set('lessonRuns/run-1/householdFinalComparison/result', comparison as unknown as Record<string, unknown>)
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('does nothing when no comparison snapshot has been persisted (defensive — should be unreachable in practice)', async () => {
    docs.set('lessonRuns/run-1', roleVariantRun)
    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: false })
    expect(rtdbUpdates).toHaveLength(0)
  })

  it('publishes the already-committed comparison snapshot to lessonRunPublic via update(), without recomputing or touching households', async () => {
    docs.set('lessonRuns/run-1', roleVariantRun)
    docs.set('lessonRuns/run-1/householdFinalComparison/result', comparison as unknown as Record<string, unknown>)

    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: false })

    expect(rtdbUpdates).toHaveLength(1)
    expect(rtdbUpdates[0].path).toBe('lessonRunPublic/run-1')
    expect(rtdbUpdates[0].data.orgId).toBe('org-1')
    expect(rtdbUpdates[0].data.householdClassComparison).toEqual(comparison)
    // No lessonRunTeamState write (the RUNNING branch's job) — REFLECTION's
    // post-commit job never touches per-household team state.
    expect(rtdbUpdates.some((u) => u.path.startsWith('lessonRunTeamState/'))).toBe(false)
  })

  /**
   * Deduplicated transition repair: a replayed RUNNING -> REFLECTION request
   * (already committed by a prior attempt) must still fire this hook and
   * still republish — but purely by reading back the ALREADY-PERSISTED
   * snapshot, never by re-running the REFLECTION gate or touching any
   * HouseholdState. This test proves that by mutating the persisted
   * snapshot directly (simulating "whatever was actually committed") and
   * confirming the replay republishes exactly that value with no other
   * side effect.
   */
  it('republishes the persisted snapshot verbatim on a deduplicated replay, without re-running settlement or state rewrite', async () => {
    docs.set('lessonRuns/run-1', roleVariantRun)
    docs.set('lessonRuns/run-1/householdFinalComparison/result', comparison as unknown as Record<string, unknown>)

    await afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: false })
    rtdbUpdates.length = 0

    await expect(afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: true })).resolves.toBeUndefined()

    expect(rtdbUpdates).toHaveLength(1)
    expect(rtdbUpdates[0].data.householdClassComparison).toEqual(comparison)
    expect(docs.has('lessonRuns/run-1/households/team-a:profile-a')).toBe(false)
  })
})
