import { describe, expect, it, vi } from 'vitest'
import {
  restoreHouseholdCheckpoint,
  restoreHouseholdCheckpointV2,
  restoreHouseholdCheckpointV3,
  type HouseholdRestoreDeps,
  type HouseholdRestoreV3Deps,
} from './householdRestore'
import type { HouseholdState } from '../lessonRuns/households/repository'
import { buildHouseholdCheckpointSnapshotV2, buildHouseholdCheckpointSnapshotV3 } from './householdCheckpoint'
import type { HouseholdStateTeamView } from './realtimeProjection'
import type { HouseholdRuntimeControl } from './statusTransition'
import type { HouseholdAssignmentConfig } from './householdAssignmentRepository'

describe('householdRestore v2', () => {
  const makeBaseHousehold = (teamId: string, cash = 1000000, roundIndex = 1): HouseholdState => ({
    householdId: teamId,
    lessonRunId: 'run-1',
    teamId,
    profileId: teamId,
    cashYen: cash,
    assetHoldingsYen: {},
    activeInsuranceContracts: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex,
    goalDelayedRounds: 0,
    updatedAtServerMillis: 1000,
  })

  const makeBaseTeamView = (teamId: string, cash = 1000000, roundIndex = 1): HouseholdStateTeamView => ({
    householdId: teamId,
    isFictional: true,
    cashYen: cash,
    assetHoldingsYen: {},
    activeInsuranceContractYearsRemaining: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex,
    goalDelayedRounds: 0,
    visibleConcepts: ['ASSET_DIVERSIFICATION'],
    eventDisclosures: [],
    shortfallOptions: [],
  })

  const snapshotHouseholds = [
    makeBaseHousehold('team-a', 2000000, 1),
    makeBaseHousehold('team-b', 3000000, 1),
  ]
  const snapshotTeamViews = {
    'team-a': makeBaseTeamView('team-a', 2000000, 1),
    'team-b': makeBaseTeamView('team-b', 3000000, 1),
  }

  const v2Snapshot = buildHouseholdCheckpointSnapshotV2({
    kind: 'MANUAL',
    label: 'Round 1 checkpoint',
    createdAtServerMillis: 1000,
    createdByUid: 'teacher-1',
    expectedRoundIndex: 1,
    householdIds: ['team-a', 'team-b'],
    households: snapshotHouseholds,
    teamViews: snapshotTeamViews,
  })

  const makeFakeFirestore = () => {
    const docs = new Map<string, Record<string, unknown>>()
    return {
      docs,
      runTransaction: async <T>(fn: (tx: {
        get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
        set: (path: string, data: Record<string, unknown>) => void
      }) => Promise<T>): Promise<T> => {
        const written = new Set<string>()
        return fn({
          get: async (path: string) => {
            if (written.has(path)) throw new Error(`read-after-write violation: ${path}`)
            return { exists: docs.has(path), data: () => docs.get(path) }
          },
          set: (path: string, data: Record<string, unknown>) => { docs.set(path, data); written.add(path) },
        })
      },
    }
  }

  const baseInput = {
    lessonRunId: 'run-1',
    checkpointId: 'hcp-1',
    reason: '復元テスト',
    actorUid: 'teacher-1',
    idempotencyKey: 'restore-key-1',
    nowMillis: 5000,
  }

  it('restores all households atomically, creates PRE_RESTORE checkpoint, and syncs RTDB', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 10 })
    fake.docs.set('lessonRuns/run-1/checkpoints/hcp-1', {
      id: 'hcp-1',
      lessonRunId: 'run-1',
      snapshot: v2Snapshot,
    })
    // Current household states (e.g. at round 3)
    fake.docs.set('lessonRuns/run-1/households/team-a', makeBaseHousehold('team-a', 500000, 3) as unknown as Record<string, unknown>)
    fake.docs.set('lessonRuns/run-1/households/team-b', makeBaseHousehold('team-b', 600000, 3) as unknown as Record<string, unknown>)

    let rtdbUpdates: Record<string, unknown> | null = null
    const deps: HouseholdRestoreDeps = {
      firestore: fake as never,
      checkActiveBulkLease: vi.fn().mockResolvedValue(false),
      findUnresolvedBulkOperationId: vi.fn().mockResolvedValue(null),
      cancelInactiveUnresolvedBulkOperationById: vi.fn().mockResolvedValue(undefined),
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore', created: true }),
      syncRtdbProjections: vi.fn().mockImplementation(async (updates) => {
        rtdbUpdates = updates
      }),
    }

    const result = await restoreHouseholdCheckpointV2(deps, baseInput)

    expect(result.newRestoreGeneration).toBe(1)
    expect(result.restoredHouseholdIds).toEqual(['team-a', 'team-b'])
    expect(deps.savePreRestoreCheckpoint).toHaveBeenCalledOnce()

    // Verify Firestore household states updated to snapshot values
    const teamA = fake.docs.get('lessonRuns/run-1/households/team-a') as unknown as HouseholdState
    expect(teamA.cashYen).toBe(2000000)
    expect(teamA.roundIndex).toBe(1)

    // Verify LessonRun restoreGeneration incremented
    const runDoc = fake.docs.get('lessonRuns/run-1') as { restoreGeneration: number }
    expect(runDoc.restoreGeneration).toBe(1)

    // Verify RTDB sync
    expect(rtdbUpdates).toBeDefined()
    expect(rtdbUpdates!['lessonRunTeamState/run-1/team-a/household']).toEqual(snapshotTeamViews['team-a'])
    expect(rtdbUpdates!['lessonRunPrivate/run-1/householdComputationLog/team-a']).toBeNull()
    expect(rtdbUpdates!['lessonRunPrivate/run-1/householdComputationLog/team-b']).toBeNull()
  })

  it('replays same key with same payload, retrying RTDB sync if pending', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 10 })
    fake.docs.set('lessonRuns/run-1/checkpoints/hcp-1', {
      id: 'hcp-1',
      lessonRunId: 'run-1',
      snapshot: v2Snapshot,
    })
    fake.docs.set('lessonRuns/run-1/households/team-a', makeBaseHousehold('team-a', 500000, 3) as unknown as Record<string, unknown>)
    fake.docs.set('lessonRuns/run-1/households/team-b', makeBaseHousehold('team-b', 600000, 3) as unknown as Record<string, unknown>)

    let syncAttempt = 0
    const deps: HouseholdRestoreDeps = {
      firestore: fake as never,
      checkActiveBulkLease: vi.fn().mockResolvedValue(false),
      findUnresolvedBulkOperationId: vi.fn().mockResolvedValue(null),
      cancelInactiveUnresolvedBulkOperationById: vi.fn().mockResolvedValue(undefined),
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore', created: true }),
      syncRtdbProjections: vi.fn().mockImplementation(async () => {
        syncAttempt++
        if (syncAttempt === 1) {
          throw new Error('RTDB network error')
        }
      }),
    }

    // First attempt fails during RTDB sync
    await expect(restoreHouseholdCheckpointV2(deps, baseInput)).rejects.toThrow('RTDB network error')

    // Second attempt replays and retries RTDB sync without double-incrementing restoreGeneration
    const secondResult = await restoreHouseholdCheckpointV2(deps, { ...baseInput, nowMillis: 6000 })
    expect(secondResult.newRestoreGeneration).toBe(1)
    expect(syncAttempt).toBe(2)
  })

  it('retries RTDB sync after the restore already committed, without re-invoking savePreRestoreCheckpoint', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 10 })
    fake.docs.set('lessonRuns/run-1/checkpoints/hcp-1', {
      id: 'hcp-1',
      lessonRunId: 'run-1',
      snapshot: v2Snapshot,
    })
    fake.docs.set('lessonRuns/run-1/households/team-a', makeBaseHousehold('team-a', 500000, 3) as unknown as Record<string, unknown>)
    fake.docs.set('lessonRuns/run-1/households/team-b', makeBaseHousehold('team-b', 600000, 3) as unknown as Record<string, unknown>)

    // Mimics production's savePreRestoreCheckpoint: its idempotency digest is
    // derived from the *current* household round indices at call time, which
    // change once the restore transaction below has committed households to
    // round 1. If restoreHouseholdCheckpointV2 called this unconditionally on
    // every attempt, a retry after the restore committed (but RTDB sync
    // failed) would recompute a digest from the now-different round index and
    // throw here instead of resuming — this stub reproduces that check.
    let savePreRestoreCallCount = 0
    let syncAttempt = 0
    const roundIndexSeenByKey = new Map<string, number>()
    const deps: HouseholdRestoreDeps = {
      firestore: fake as never,
      checkActiveBulkLease: vi.fn().mockResolvedValue(false),
      findUnresolvedBulkOperationId: vi.fn().mockResolvedValue(null),
      cancelInactiveUnresolvedBulkOperationById: vi.fn().mockResolvedValue(undefined),
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockImplementation(async (input) => {
        savePreRestoreCallCount++
        const currentRoundIndex = (fake.docs.get('lessonRuns/run-1/households/team-a') as unknown as HouseholdState).roundIndex
        const priorRoundIndex = roundIndexSeenByKey.get(input.idempotencyKey)
        if (priorRoundIndex !== undefined && priorRoundIndex !== currentRoundIndex) {
          throw new Error('Idempotency key payload mismatch')
        }
        roundIndexSeenByKey.set(input.idempotencyKey, currentRoundIndex)
        return { checkpointId: 'hcp-pre-restore', created: priorRoundIndex === undefined }
      }),
      syncRtdbProjections: vi.fn().mockImplementation(async () => {
        syncAttempt++
        if (syncAttempt === 1) throw new Error('RTDB network error')
      }),
    }

    // First attempt: the restore transaction commits households to round 1,
    // then RTDB sync fails.
    await expect(restoreHouseholdCheckpointV2(deps, baseInput)).rejects.toThrow('RTDB network error')
    expect(savePreRestoreCallCount).toBe(1)

    // Second attempt (retry): household round index is now 1 (post-restore),
    // not 3. savePreRestoreCheckpoint must not be called again — if it were,
    // this stub would detect the round-index change and throw a digest
    // mismatch, same as the real implementation would.
    await expect(restoreHouseholdCheckpointV2(deps, { ...baseInput, nowMillis: 6000 })).resolves.toMatchObject({ newRestoreGeneration: 1 })
    expect(savePreRestoreCallCount).toBe(1)
  })

  it('rejects v1 checkpoint snapshot', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/checkpoints/hcp-v1', {
      id: 'hcp-v1',
      lessonRunId: 'run-1',
      snapshot: { schemaVersion: 1, households: snapshotHouseholds },
    })

    const deps: HouseholdRestoreDeps = {
      firestore: fake as never,
      checkActiveBulkLease: vi.fn().mockResolvedValue(false),
      findUnresolvedBulkOperationId: vi.fn().mockResolvedValue(null),
      cancelInactiveUnresolvedBulkOperationById: vi.fn().mockResolvedValue(undefined),
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore', created: true }),
      syncRtdbProjections: vi.fn().mockResolvedValue(undefined),
    }

    await expect(
      restoreHouseholdCheckpointV2(deps, { ...baseInput, checkpointId: 'hcp-v1' }),
    ).rejects.toThrow('v2')
  })

  it('rejects restore if active bulk lease is present', async () => {
    const fake = makeFakeFirestore()
    const deps: HouseholdRestoreDeps = {
      firestore: fake as never,
      checkActiveBulkLease: vi.fn().mockResolvedValue(true),
      findUnresolvedBulkOperationId: vi.fn().mockResolvedValue(null),
      cancelInactiveUnresolvedBulkOperationById: vi.fn().mockResolvedValue(undefined),
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore', created: true }),
      syncRtdbProjections: vi.fn().mockResolvedValue(undefined),
    }

    await expect(restoreHouseholdCheckpointV2(deps, baseInput)).rejects.toThrow('Active bulk operation lease')
  })

  it('cancels an inactive unresolved bulk operation as part of restore (regression: NEW behavior, not just wiring)', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 10 })
    fake.docs.set('lessonRuns/run-1/checkpoints/hcp-1', {
      id: 'hcp-1',
      lessonRunId: 'run-1',
      snapshot: v2Snapshot,
    })
    fake.docs.set('lessonRuns/run-1/households/team-a', makeBaseHousehold('team-a', 500000, 3) as unknown as Record<string, unknown>)
    fake.docs.set('lessonRuns/run-1/households/team-b', makeBaseHousehold('team-b', 600000, 3) as unknown as Record<string, unknown>)

    const findSpy = vi.fn().mockResolvedValue('stale-op-1')
    const cancelSpy = vi.fn().mockResolvedValue(undefined)
    const deps: HouseholdRestoreDeps = {
      firestore: fake as never,
      checkActiveBulkLease: vi.fn().mockResolvedValue(false),
      findUnresolvedBulkOperationId: findSpy,
      cancelInactiveUnresolvedBulkOperationById: cancelSpy,
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore', created: true }),
      syncRtdbProjections: vi.fn().mockResolvedValue(undefined),
    }

    await restoreHouseholdCheckpointV2(deps, baseInput)

    expect(findSpy).toHaveBeenCalledWith('run-1')
    expect(cancelSpy).toHaveBeenCalledWith('stale-op-1', baseInput.nowMillis)
  })

  it('does NOT re-run the bulk-cancel cleanup on a retry of an already-committed restore', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 10 })
    fake.docs.set('lessonRuns/run-1/checkpoints/hcp-1', {
      id: 'hcp-1',
      lessonRunId: 'run-1',
      snapshot: v2Snapshot,
    })
    fake.docs.set('lessonRuns/run-1/households/team-a', makeBaseHousehold('team-a', 500000, 3) as unknown as Record<string, unknown>)
    fake.docs.set('lessonRuns/run-1/households/team-b', makeBaseHousehold('team-b', 600000, 3) as unknown as Record<string, unknown>)

    const findSpy = vi.fn().mockResolvedValue(null)
    const cancelSpy = vi.fn().mockResolvedValue(undefined)
    const deps: HouseholdRestoreDeps = {
      firestore: fake as never,
      checkActiveBulkLease: vi.fn().mockResolvedValue(false),
      findUnresolvedBulkOperationId: findSpy,
      cancelInactiveUnresolvedBulkOperationById: cancelSpy,
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore', created: true }),
      syncRtdbProjections: vi.fn().mockResolvedValue(undefined),
    }

    // First attempt: genuinely new — the cancel step runs once.
    await restoreHouseholdCheckpointV2(deps, baseInput)
    expect(findSpy).toHaveBeenCalledTimes(1)

    // Second attempt: replay of the SAME idempotencyKey, already committed —
    // the cancel step must be skipped entirely, so it can never target a
    // different (newer, legitimate) operation that appeared after the first
    // attempt committed.
    await restoreHouseholdCheckpointV2(deps, { ...baseInput, nowMillis: 6000 })
    expect(findSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).not.toHaveBeenCalled()
  })
})

describe('householdRestore v3 (advanced formats)', () => {
  const makeHousehold = (householdId: string, teamId: string, cash = 1000000, roundIndex = 1): HouseholdState => ({
    householdId,
    lessonRunId: 'run-1',
    teamId,
    profileId: 'profile-1',
    cashYen: cash,
    assetHoldingsYen: {},
    activeInsuranceContracts: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex,
    goalDelayedRounds: 0,
    updatedAtServerMillis: 1000,
  })

  const v3Snapshot = buildHouseholdCheckpointSnapshotV3({
    courseFormat: 'ROLE_VARIANT',
    assignmentRevision: 5,
    restoreGeneration: 0,
    expectedRoundIndex: 1,
    householdIds: ['hh-a', 'hh-b'],
    householdStates: [
      makeHousehold('hh-a', 'team-a', 2000000, 1),
      makeHousehold('hh-b', 'team-b', 3000000, 1),
    ],
    visibleConcepts: ['ASSET_DIVERSIFICATION'],
    createdAtServerMillis: 1000,
  })

  const controlPath = 'lessonRuns/run-1/householdRuntime/control'
  const assignmentConfigPath = 'lessonRuns/run-1/householdAssignment/config'

  const openControl: HouseholdRuntimeControl = {
    courseFormat: 'ROLE_VARIANT',
    assignmentRevision: 5,
    synchronizedRoundIndex: 3,
    roundStatus: 'OPEN',
    activeOperationId: null,
    updatedAtServerMillis: 900,
  }

  const frozenAssignmentConfig: HouseholdAssignmentConfig = {
    courseFormat: 'ROLE_VARIANT',
    state: 'FROZEN',
    validationStatus: 'READY',
    assignmentRevision: 5,
    teamSetFingerprint: 'fp-1',
    entryIds: ['hh-a', 'hh-b'],
    entriesDigest: 'digest-1',
    lastEditedByUid: 'teacher-1',
    lastEditedAtServerMillis: 100,
    frozenByUid: 'teacher-1',
    frozenAtServerMillis: 200,
  }

  const makeFakeFirestore = () => {
    const docs = new Map<string, Record<string, unknown>>()
    return {
      docs,
      runTransaction: async <T>(fn: (tx: {
        get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
        set: (path: string, data: Record<string, unknown>) => void
      }) => Promise<T>): Promise<T> => {
        const written = new Set<string>()
        return fn({
          get: async (path: string) => {
            if (written.has(path)) throw new Error(`read-after-write violation: ${path}`)
            return { exists: docs.has(path), data: () => docs.get(path) }
          },
          set: (path: string, data: Record<string, unknown>) => { docs.set(path, data); written.add(path) },
        })
      },
    }
  }

  const seedBaseDocs = (fake: ReturnType<typeof makeFakeFirestore>) => {
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 10 })
    fake.docs.set('lessonRuns/run-1/checkpoints/hcp-1', {
      id: 'hcp-1',
      lessonRunId: 'run-1',
      snapshot: v3Snapshot,
    })
    fake.docs.set('lessonRuns/run-1/households/hh-a', makeHousehold('hh-a', 'team-a', 500000, 3) as unknown as Record<string, unknown>)
    fake.docs.set('lessonRuns/run-1/households/hh-b', makeHousehold('hh-b', 'team-b', 600000, 3) as unknown as Record<string, unknown>)
    fake.docs.set(controlPath, openControl as unknown as Record<string, unknown>)
    fake.docs.set(assignmentConfigPath, frozenAssignmentConfig as unknown as Record<string, unknown>)
  }

  const baseInput = {
    lessonRunId: 'run-1',
    checkpointId: 'hcp-1',
    reason: '復元テスト',
    actorUid: 'teacher-1',
    idempotencyKey: 'restore-key-v3-1',
    nowMillis: 5000,
  }

  const makeDeps = (fake: ReturnType<typeof makeFakeFirestore>, overrides: Partial<HouseholdRestoreV3Deps> = {}): HouseholdRestoreV3Deps => ({
    firestore: fake as never,
    checkActiveBulkLease: vi.fn().mockResolvedValue(false),
    findUnresolvedBulkOperationId: vi.fn().mockResolvedValue(null),
    cancelInactiveUnresolvedBulkOperationById: vi.fn().mockResolvedValue(undefined),
    savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore-v3', created: true }),
    syncRtdbProjections: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  })

  it('restores states, increments generation, and rewrites control to OPEN/no-active-op/checkpoint round in the same transaction', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)

    let rtdbUpdates: Record<string, unknown> | null = null
    const deps = makeDeps(fake, {
      syncRtdbProjections: vi.fn().mockImplementation(async (updates) => { rtdbUpdates = updates }),
    })

    const result = await restoreHouseholdCheckpointV3(deps, baseInput)

    expect(result.newRestoreGeneration).toBe(1)
    expect(result.restoredHouseholdIds).toEqual(['hh-a', 'hh-b'])
    expect(deps.savePreRestoreCheckpoint).toHaveBeenCalledOnce()

    const hhA = fake.docs.get('lessonRuns/run-1/households/hh-a') as unknown as HouseholdState
    expect(hhA.cashYen).toBe(2000000)
    expect(hhA.roundIndex).toBe(1)

    const runDoc = fake.docs.get('lessonRuns/run-1') as { restoreGeneration: number }
    expect(runDoc.restoreGeneration).toBe(1)

    const control = fake.docs.get(controlPath) as unknown as HouseholdRuntimeControl
    expect(control.roundStatus).toBe('OPEN')
    expect(control.activeOperationId).toBeNull()
    expect(control.synchronizedRoundIndex).toBe(1) // checkpoint's expectedRoundIndex
    expect(control.assignmentRevision).toBe(5) // unchanged

    expect(rtdbUpdates).toBeDefined()
    expect(rtdbUpdates!['lessonRunTeamState/run-1/team-a/households']).toBeDefined()
    expect(rtdbUpdates!['lessonRunTeamState/run-1/team-a/householdOrder']).toEqual(['hh-a'])
    expect(rtdbUpdates!['lessonRunPrivate/run-1/householdComputationLog/hh-a']).toBeNull()
    expect(rtdbUpdates!['lessonRunPrivate/run-1/householdComputationLog/hh-b']).toBeNull()

    // Critical C1 (whole-branch review): the v3 restore write previously
    // omitted `roundStatus`/`synchronizedRoundIndex`/`courseFormat`
    // entirely, leaving each team's RTDB node stuck at whatever it showed
    // BEFORE the restore — even though the transaction above just rewound
    // the Firestore control doc to `roundStatus: 'OPEN'` at the checkpoint's
    // round. Both team nodes must now carry the SAME trio the control doc
    // was just reset to.
    for (const teamId of ['team-a', 'team-b']) {
      expect(rtdbUpdates![`lessonRunTeamState/run-1/${teamId}/roundStatus`]).toBe('OPEN')
      expect(rtdbUpdates![`lessonRunTeamState/run-1/${teamId}/synchronizedRoundIndex`]).toBe(1)
      expect(rtdbUpdates![`lessonRunTeamState/run-1/${teamId}/courseFormat`]).toBe('ROLE_VARIANT')
    }
  })

  /**
   * Critical C1 regression, isolated to the exact bug scenario: the control
   * doc BEFORE restore is stuck `SETTLING` (e.g. restoring precisely to
   * recover from a wedged bulk operation) — the fix must republish `OPEN`
   * to RTDB regardless of what `roundStatus` happened to be beforehand,
   * since the restore transaction unconditionally rewinds control to OPEN.
   */
  it('republishes roundStatus OPEN to RTDB even when the pre-restore control doc was stuck SETTLING (Critical C1)', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)
    fake.docs.set(controlPath, { ...openControl, roundStatus: 'SETTLING', activeOperationId: 'stuck-op' } as unknown as Record<string, unknown>)

    let rtdbUpdates: Record<string, unknown> | null = null
    const deps = makeDeps(fake, {
      syncRtdbProjections: vi.fn().mockImplementation(async (updates) => { rtdbUpdates = updates }),
    })

    await restoreHouseholdCheckpointV3(deps, baseInput)

    const control = fake.docs.get(controlPath) as unknown as HouseholdRuntimeControl
    expect(control.roundStatus).toBe('OPEN')
    expect(rtdbUpdates!['lessonRunTeamState/run-1/team-a/roundStatus']).toBe('OPEN')
    expect(rtdbUpdates!['lessonRunTeamState/run-1/team-b/roundStatus']).toBe('OPEN')
  })

  it('rejects when the current HouseholdAssignmentConfig assignmentRevision does not match the checkpoint snapshot', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)
    fake.docs.set(assignmentConfigPath, {
      ...frozenAssignmentConfig,
      assignmentRevision: 6, // drifted since the checkpoint was created
    } as unknown as Record<string, unknown>)

    const deps = makeDeps(fake)

    await expect(restoreHouseholdCheckpointV3(deps, baseInput)).rejects.toThrow('assignmentRevision')
  })

  it('rejects when the current HouseholdAssignmentConfig is not FROZEN', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)
    fake.docs.set(assignmentConfigPath, {
      ...frozenAssignmentConfig,
      state: 'DRAFT',
    } as unknown as Record<string, unknown>)

    const deps = makeDeps(fake)

    await expect(restoreHouseholdCheckpointV3(deps, baseInput)).rejects.toThrow('FROZEN')
  })

  it('rejects restore if active bulk lease is present', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)
    const deps = makeDeps(fake, { checkActiveBulkLease: vi.fn().mockResolvedValue(true) })

    await expect(restoreHouseholdCheckpointV3(deps, baseInput)).rejects.toThrow('Active bulk operation lease')
  })

  it('crash-safe: retries RTDB sync without double-incrementing restoreGeneration', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)

    let syncAttempt = 0
    const deps = makeDeps(fake, {
      syncRtdbProjections: vi.fn().mockImplementation(async () => {
        syncAttempt++
        if (syncAttempt === 1) throw new Error('RTDB network error')
      }),
    })

    await expect(restoreHouseholdCheckpointV3(deps, baseInput)).rejects.toThrow('RTDB network error')

    const secondResult = await restoreHouseholdCheckpointV3(deps, { ...baseInput, nowMillis: 6000 })
    expect(secondResult.newRestoreGeneration).toBe(1)
    expect(syncAttempt).toBe(2)
  })

  it('cancels an inactive unresolved bulk operation as part of restore', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)

    const findSpy = vi.fn().mockResolvedValue('stale-op-v3-1')
    const cancelSpy = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps(fake, { findUnresolvedBulkOperationId: findSpy, cancelInactiveUnresolvedBulkOperationById: cancelSpy })

    await restoreHouseholdCheckpointV3(deps, baseInput)

    expect(findSpy).toHaveBeenCalledWith('run-1')
    expect(cancelSpy).toHaveBeenCalledWith('stale-op-v3-1', baseInput.nowMillis)
  })

  it('does NOT re-run the bulk-cancel cleanup on a retry of an already-committed restore', async () => {
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)

    const findSpy = vi.fn().mockResolvedValue(null)
    const cancelSpy = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps(fake, { findUnresolvedBulkOperationId: findSpy, cancelInactiveUnresolvedBulkOperationById: cancelSpy })

    await restoreHouseholdCheckpointV3(deps, baseInput)
    expect(findSpy).toHaveBeenCalledTimes(1)

    await restoreHouseholdCheckpointV3(deps, { ...baseInput, nowMillis: 6000 })
    expect(findSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).not.toHaveBeenCalled()
  })

  it('never cancels a genuinely new concurrent bulk operation created after the restore captured its own target id', async () => {
    // Regression for the race: `findUnresolvedBulkOperationId` is called
    // ONCE and its result captured — even if a DIFFERENT operation becomes
    // "unresolved" afterward (e.g. another teacher device starts a fresh
    // bulk settlement in the gap before the cancel-by-id call runs), the
    // cancel step must only ever target the id captured at lookup time.
    const fake = makeFakeFirestore()
    seedBaseDocs(fake)

    const findSpy = vi.fn().mockResolvedValue('stale-op-v3-1')
    const cancelSpy = vi.fn().mockImplementation(async (operationId: string) => {
      // Simulate a brand-new concurrent operation ('new-concurrent-op')
      // appearing in Firestore between the lookup and the cancel call. The
      // production `cancelInactiveUnresolvedBulkOperationById` wiring fetches
      // strictly by the given `operationId`, so it can never observe or
      // touch this new operation — this spy asserts the CALLER never passes
      // its id either.
      expect(operationId).toBe('stale-op-v3-1')
      expect(operationId).not.toBe('new-concurrent-op')
    })
    const deps = makeDeps(fake, { findUnresolvedBulkOperationId: findSpy, cancelInactiveUnresolvedBulkOperationById: cancelSpy })

    await restoreHouseholdCheckpointV3(deps, baseInput)

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledWith('stale-op-v3-1', baseInput.nowMillis)
  })
})

describe('restoreHouseholdCheckpoint (schema-version dispatcher)', () => {
  const dispatchInput = {
    lessonRunId: 'run-1',
    checkpointId: 'hcp-1',
    reason: '復元テスト',
    actorUid: 'teacher-1',
    idempotencyKey: 'restore-key-dispatch-1',
    nowMillis: 5000,
  }

  const v2Result = { newRestoreGeneration: 1, restoredHouseholdIds: ['team-a'], preRestoreCheckpointId: 'pre-1' }
  const v3Result = { newRestoreGeneration: 1, restoredHouseholdIds: ['hh-a'], preRestoreCheckpointId: 'pre-2' }

  it('routes a v3-shaped checkpoint snapshot to restoreV3 and tags schemaVersion: 3', async () => {
    const v3Snapshot = buildHouseholdCheckpointSnapshotV3({
      courseFormat: 'ROLE_VARIANT',
      assignmentRevision: 5,
      restoreGeneration: 0,
      expectedRoundIndex: 1,
      householdIds: ['hh-a'],
      householdStates: [{
        householdId: 'hh-a',
        lessonRunId: 'run-1',
        teamId: 'team-a',
        profileId: 'profile-1',
        cashYen: 1000000,
        assetHoldingsYen: {},
        activeInsuranceContracts: {},
        activeLiabilities: {},
        lifeStage: 'INDEPENDENT',
        roundIndex: 1,
        goalDelayedRounds: 0,
        updatedAtServerMillis: 1000,
      }],
      visibleConcepts: ['ASSET_DIVERSIFICATION'],
      createdAtServerMillis: 1000,
    })
    const restoreV2 = vi.fn().mockResolvedValue(v2Result)
    const restoreV3 = vi.fn().mockResolvedValue(v3Result)

    const result = await restoreHouseholdCheckpoint(
      {
        getCheckpointSnapshot: vi.fn().mockResolvedValue(v3Snapshot),
        restoreV2,
        restoreV3,
      },
      dispatchInput,
    )

    expect(restoreV3).toHaveBeenCalledWith(dispatchInput)
    expect(restoreV2).not.toHaveBeenCalled()
    expect(result).toEqual({ ...v3Result, schemaVersion: 3 })
  })

  it('routes a v2-shaped checkpoint snapshot to restoreV2 and tags schemaVersion: 2', async () => {
    const v2Snapshot = buildHouseholdCheckpointSnapshotV2({
      kind: 'MANUAL',
      label: 'checkpoint',
      createdAtServerMillis: 1000,
      createdByUid: 'teacher-1',
      expectedRoundIndex: 1,
      householdIds: ['team-a'],
      households: [{
        householdId: 'team-a',
        lessonRunId: 'run-1',
        teamId: 'team-a',
        profileId: 'team-a',
        cashYen: 1000000,
        assetHoldingsYen: {},
        activeInsuranceContracts: {},
        activeLiabilities: {},
        lifeStage: 'INDEPENDENT',
        roundIndex: 1,
        goalDelayedRounds: 0,
        updatedAtServerMillis: 1000,
      }],
      teamViews: {},
    })
    const restoreV2 = vi.fn().mockResolvedValue(v2Result)
    const restoreV3 = vi.fn().mockResolvedValue(v3Result)

    const result = await restoreHouseholdCheckpoint(
      {
        getCheckpointSnapshot: vi.fn().mockResolvedValue(v2Snapshot),
        restoreV2,
        restoreV3,
      },
      dispatchInput,
    )

    expect(restoreV2).toHaveBeenCalledWith(dispatchInput)
    expect(restoreV3).not.toHaveBeenCalled()
    expect(result).toEqual({ ...v2Result, schemaVersion: 2 })
  })

  it('routes a malformed/v1 checkpoint snapshot to restoreV2 (falls through, does not misroute to v3)', async () => {
    const restoreV2 = vi.fn().mockResolvedValue(v2Result)
    const restoreV3 = vi.fn().mockResolvedValue(v3Result)

    const result = await restoreHouseholdCheckpoint(
      {
        getCheckpointSnapshot: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
        restoreV2,
        restoreV3,
      },
      dispatchInput,
    )

    expect(restoreV2).toHaveBeenCalledWith(dispatchInput)
    expect(restoreV3).not.toHaveBeenCalled()
    expect(result).toEqual({ ...v2Result, schemaVersion: 2 })
  })
})
