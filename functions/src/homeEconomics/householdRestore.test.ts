import { describe, expect, it, vi } from 'vitest'
import {
  restoreHouseholdCheckpointV2,
  type HouseholdRestoreDeps,
} from './householdRestore'
import type { HouseholdState } from '../lessonRuns/households/repository'
import { buildHouseholdCheckpointSnapshotV2 } from './householdCheckpoint'
import type { HouseholdStateTeamView } from './realtimeProjection'

describe('householdRestore v2', () => {
  const makeBaseHousehold = (teamId: string, cash = 1000000, roundIndex = 1): HouseholdState => ({
    householdId: teamId,
    lessonRunId: 'run-1',
    teamId,
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
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      savePreRestoreCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'hcp-pre-restore', created: true }),
      syncRtdbProjections: vi.fn().mockResolvedValue(undefined),
    }

    await expect(restoreHouseholdCheckpointV2(deps, baseInput)).rejects.toThrow('Active bulk operation lease')
  })
})
