import { describe, expect, it } from 'vitest'
import {
  buildHouseholdCheckpointSnapshotV2,
  isHouseholdCheckpointSnapshotV2,
  listHouseholdCheckpointManifests,
  writeHouseholdCheckpointV2,
  type HouseholdCheckpointSnapshotV2,
} from './householdCheckpoint'
import type { HouseholdState } from '../lessonRuns/households/repository'
import type { HouseholdStateTeamView } from './realtimeProjection'

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

describe('householdCheckpoint v2 codec & manifest', () => {
  const validHousehold: HouseholdState = {
    householdId: 'team-a',
    lessonRunId: 'run-1',
    teamId: 'team-a',
    cashYen: 1000000,
    assetHoldingsYen: {},
    activeInsuranceContracts: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex: 1,
    goalDelayedRounds: 0,
    updatedAtServerMillis: 1000,
  }

  const validTeamView: HouseholdStateTeamView = {
    householdId: 'team-a',
    isFictional: true,
    cashYen: 1000000,
    assetHoldingsYen: {},
    activeInsuranceContractYearsRemaining: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex: 1,
    goalDelayedRounds: 0,
    visibleConcepts: ['ASSET_DIVERSIFICATION'],
    eventDisclosures: [],
    shortfallOptions: [],
  }

  it('validates v2 snapshot with isHouseholdCheckpointSnapshotV2', () => {
    const snapshot = buildHouseholdCheckpointSnapshotV2({
      kind: 'MANUAL',
      label: '保存点1',
      createdAtServerMillis: 2000,
      createdByUid: 'teacher-1',
      expectedRoundIndex: 1,
      householdIds: ['team-a'],
      households: [validHousehold],
      teamViews: { 'team-a': validTeamView },
    })

    expect(isHouseholdCheckpointSnapshotV2(snapshot)).toBe(true)
  })

  it('rejects v1 or malformed snapshot in isHouseholdCheckpointSnapshotV2', () => {
    const v1 = { schemaVersion: 1, households: [validHousehold] }
    expect(isHouseholdCheckpointSnapshotV2(v1)).toBe(false)
    expect(isHouseholdCheckpointSnapshotV2(null)).toBe(false)
    expect(isHouseholdCheckpointSnapshotV2({ schemaVersion: 2, scope: 'SOME_HOUSEHOLDS' })).toBe(false)
  })

  it('lists only v2 + ALL_HOUSEHOLDS manifests and excludes v1', () => {
    const docs = [
      {
        id: 'cp-v1',
        data: {
          restoreGeneration: 0,
          snapshot: { schemaVersion: 1, households: [validHousehold] },
        },
      },
      {
        id: 'cp-v2',
        data: {
          restoreGeneration: 0,
          snapshot: buildHouseholdCheckpointSnapshotV2({
            kind: 'MANUAL',
            label: '保存点2',
            createdAtServerMillis: 3000,
            createdByUid: 'teacher-1',
            expectedRoundIndex: 1,
            householdIds: ['team-a'],
            households: [validHousehold],
            teamViews: { 'team-a': validTeamView },
          }),
        },
      },
    ]

    const manifests = listHouseholdCheckpointManifests(docs)
    expect(manifests).toHaveLength(1)
    expect(manifests[0].checkpointId).toBe('cp-v2')
    expect(manifests[0].label).toBe('保存点2')
    expect(manifests[0].kind).toBe('MANUAL')
  })
})

describe('writeHouseholdCheckpointV2 idempotency & persistence', () => {
  const validHousehold: HouseholdState = {
    householdId: 'team-a',
    lessonRunId: 'run-1',
    teamId: 'team-a',
    cashYen: 1000000,
    assetHoldingsYen: {},
    activeInsuranceContracts: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex: 0,
    goalDelayedRounds: 0,
    updatedAtServerMillis: 1000,
  }

  const validTeamView: HouseholdStateTeamView = {
    householdId: 'team-a',
    isFictional: true,
    cashYen: 1000000,
    assetHoldingsYen: {},
    activeInsuranceContractYearsRemaining: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex: 0,
    goalDelayedRounds: 0,
    visibleConcepts: ['ASSET_DIVERSIFICATION'],
    eventDisclosures: [],
    shortfallOptions: [],
  }

  const baseInput = {
    lessonRunId: 'run-1',
    householdIds: ['team-a'],
    kind: 'MANUAL' as const,
    label: 'テスト保存',
    expectedRoundIndex: 0,
    actorUid: 'teacher-1',
    idempotencyKey: 'idemp-key-1',
    nowMillis: 2000,
  }

  it('creates checkpoint and mapping in one transaction', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 5 })
    fake.docs.set('lessonRuns/run-1/households/team-a', validHousehold as unknown as Record<string, unknown>)

    const result = await writeHouseholdCheckpointV2({
      firestore: fake as never,
      readTeamView: async () => validTeamView,
      ...baseInput,
    })

    expect(result.created).toBe(true)
    expect(result.checkpointId).toContain('hcp_0_')

    const cpDoc = fake.docs.get(`lessonRuns/run-1/checkpoints/${result.checkpointId}`)
    expect(cpDoc).toBeDefined()
    expect(cpDoc?.sequence).toBe(5)
    expect(cpDoc?.phaseId).toBe('phase-1')
    expect((cpDoc!.snapshot as HouseholdCheckpointSnapshotV2).schemaVersion).toBe(2)
  })

  it('replays same key with same payload even if sequence or household changes, returning original checkpointId', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 5 })
    fake.docs.set('lessonRuns/run-1/households/team-a', validHousehold as unknown as Record<string, unknown>)

    const first = await writeHouseholdCheckpointV2({
      firestore: fake as never,
      readTeamView: async () => validTeamView,
      ...baseInput,
    })

    // Advance event sequence and mutate household state
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 10 })
    fake.docs.set('lessonRuns/run-1/households/team-a', { ...validHousehold, cashYen: 9999999 } as unknown as Record<string, unknown>)

    const second = await writeHouseholdCheckpointV2({
      firestore: fake as never,
      readTeamView: async () => validTeamView,
      ...baseInput,
      nowMillis: 3000,
    })

    expect(second.created).toBe(false)
    expect(second.checkpointId).toBe(first.checkpointId)
  })

  it('rejects same key with different intent payload', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 5 })
    fake.docs.set('lessonRuns/run-1/households/team-a', validHousehold as unknown as Record<string, unknown>)

    await writeHouseholdCheckpointV2({
      firestore: fake as never,
      readTeamView: async () => validTeamView,
      ...baseInput,
    })

    await expect(
      writeHouseholdCheckpointV2({
        firestore: fake as never,
        readTeamView: async () => validTeamView,
        ...baseInput,
        label: '別のラベル',
      }),
    ).rejects.toThrow('Idempotency key payload mismatch')
  })
})
