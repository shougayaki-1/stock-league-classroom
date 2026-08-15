import { describe, expect, it } from 'vitest'
import {
  buildHouseholdCheckpointSnapshotV2,
  buildHouseholdCheckpointSnapshotV3,
  isHouseholdCheckpointSnapshotV2,
  isHouseholdCheckpointSnapshotV3,
  listHouseholdCheckpointManifests,
  writeHouseholdCheckpointV2,
  writeHouseholdCheckpointV3,
  type HouseholdCheckpointSnapshotV2,
  type HouseholdCheckpointSnapshotV3,
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
    profileId: 'team-a',
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
    profileId: 'team-a',
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

  it('Common v2 regression: v3-only fields are absent and isHouseholdCheckpointSnapshotV3 rejects a v2 snapshot', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, currentPhaseId: 'phase-1' })
    fake.docs.set('lessonRuns/run-1/meta/eventCounter', { value: 5 })
    fake.docs.set('lessonRuns/run-1/households/team-a', validHousehold as unknown as Record<string, unknown>)

    const result = await writeHouseholdCheckpointV2({
      firestore: fake as never,
      readTeamView: async () => validTeamView,
      ...baseInput,
    })

    const cpDoc = fake.docs.get(`lessonRuns/run-1/checkpoints/${result.checkpointId}`)
    const snapshot = cpDoc!.snapshot as HouseholdCheckpointSnapshotV2
    expect(snapshot.schemaVersion).toBe(2)
    expect(isHouseholdCheckpointSnapshotV3(snapshot)).toBe(false)
    // v2's own shape is untouched by the v3 addition: households keyed by
    // teamId (not nested households/householdOrder), no assignmentRevision.
    expect(snapshot.teamViews['team-a']).toEqual(validTeamView)
    expect((snapshot as unknown as Record<string, unknown>).assignmentRevision).toBeUndefined()
  })
})

describe('householdCheckpoint v3 codec (advanced formats)', () => {
  const makeHousehold = (householdId: string, teamId: string, roundIndex = 1): HouseholdState => ({
    householdId,
    lessonRunId: 'run-1',
    teamId,
    profileId: `profile-${householdId}`,
    cashYen: 1000000,
    assetHoldingsYen: {},
    activeInsuranceContracts: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex,
    goalDelayedRounds: 0,
    updatedAtServerMillis: 1000,
  })

  describe('buildHouseholdCheckpointSnapshotV3', () => {
    it('includes every runtime household exactly once', () => {
      const households = [
        makeHousehold('hh-a', 'team-1'),
        makeHousehold('hh-b', 'team-2'),
        makeHousehold('hh-c', 'team-3'),
      ]
      const snapshot = buildHouseholdCheckpointSnapshotV3({
        courseFormat: 'ROLE_VARIANT',
        assignmentRevision: 3,
        restoreGeneration: 0,
        expectedRoundIndex: 1,
        householdIds: households.map((h) => h.householdId),
        householdStates: households,
        visibleConcepts: ['ASSET_DIVERSIFICATION'],
        createdAtServerMillis: 5000,
      })

      expect(isHouseholdCheckpointSnapshotV3(snapshot)).toBe(true)
      expect(snapshot.householdIds).toEqual(['hh-a', 'hh-b', 'hh-c'])
      expect(snapshot.householdStates).toHaveLength(3)
      const allHouseholdIdsAcrossTeamViews = Object.values(snapshot.teamViews)
        .flatMap((teamView) => Object.keys(teamView.households))
      expect(allHouseholdIdsAcrossTeamViews.sort()).toEqual(['hh-a', 'hh-b', 'hh-c'])
    })

    it('MULTI_PERSON_PER_TEAM: multiple households under one team do not overwrite each other in teamViews', () => {
      const households = [
        makeHousehold('hh-a', 'team-1'),
        makeHousehold('hh-b', 'team-1'),
        makeHousehold('hh-c', 'team-1'),
      ]
      const snapshot = buildHouseholdCheckpointSnapshotV3({
        courseFormat: 'MULTI_PERSON_PER_TEAM',
        assignmentRevision: 1,
        restoreGeneration: 0,
        expectedRoundIndex: 0,
        householdIds: households.map((h) => h.householdId),
        householdStates: households,
        visibleConcepts: [],
        createdAtServerMillis: 1000,
      })

      expect(Object.keys(snapshot.teamViews)).toEqual(['team-1'])
      const teamView = snapshot.teamViews['team-1']
      expect(Object.keys(teamView.households).sort()).toEqual(['hh-a', 'hh-b', 'hh-c'])
      expect(teamView.householdOrder).toEqual(['hh-a', 'hh-b', 'hh-c'])
      // Each sibling keeps its own distinct view — none were clobbered.
      expect(teamView.households['hh-a'].householdId).toBe('hh-a')
      expect(teamView.households['hh-b'].householdId).toBe('hh-b')
      expect(teamView.households['hh-c'].householdId).toBe('hh-c')
    })
  })

  describe('isHouseholdCheckpointSnapshotV3', () => {
    it('rejects a v2 snapshot and malformed input', () => {
      expect(isHouseholdCheckpointSnapshotV3({ schemaVersion: 2, scope: 'ALL_HOUSEHOLDS' })).toBe(false)
      expect(isHouseholdCheckpointSnapshotV3(null)).toBe(false)
      expect(isHouseholdCheckpointSnapshotV3({ schemaVersion: 3, scope: 'SOME_HOUSEHOLDS' })).toBe(false)
    })
  })

  describe('writeHouseholdCheckpointV3 idempotency & persistence', () => {
    const baseInput = {
      lessonRunId: 'run-1',
      courseFormat: 'ROLE_VARIANT' as const,
      householdIds: ['hh-a', 'hh-b'],
      assignmentRevision: 7,
      kind: 'PRE_SETTLEMENT' as const,
      label: '第2ラウンド 決算前',
      expectedRoundIndex: 1,
      actorUid: 'teacher-1',
      idempotencyKey: 'idemp-v3-1',
      nowMillis: 2000,
      visibleConcepts: ['ASSET_DIVERSIFICATION'] as const,
    }

    const setUpFakeHouseholds = (fake: ReturnType<typeof makeFakeFirestore>) => {
      fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0 })
      fake.docs.set('lessonRuns/run-1/households/hh-a', makeHousehold('hh-a', 'team-1') as unknown as Record<string, unknown>)
      fake.docs.set('lessonRuns/run-1/households/hh-b', makeHousehold('hh-b', 'team-2') as unknown as Record<string, unknown>)
    }

    it('creates a v3 checkpoint and mapping in one transaction, covering every household exactly once', async () => {
      const fake = makeFakeFirestore()
      setUpFakeHouseholds(fake)

      const result = await writeHouseholdCheckpointV3({
        firestore: fake as never,
        ...baseInput,
        visibleConcepts: [...baseInput.visibleConcepts],
      })

      expect(result.created).toBe(true)
      const cpDoc = fake.docs.get(`lessonRuns/run-1/checkpoints/${result.checkpointId}`)
      expect(cpDoc).toBeDefined()
      expect(cpDoc?.kind).toBe('PRE_SETTLEMENT')
      expect(cpDoc?.label).toBe('第2ラウンド 決算前')
      expect(cpDoc?.createdByUid).toBe('teacher-1')
      const snapshot = cpDoc!.snapshot as HouseholdCheckpointSnapshotV3
      expect(snapshot.schemaVersion).toBe(3)
      expect(snapshot.courseFormat).toBe('ROLE_VARIANT')
      expect(snapshot.assignmentRevision).toBe(7)
      expect(snapshot.householdIds).toEqual(['hh-a', 'hh-b'])
      expect(snapshot.householdStates).toHaveLength(2)
    })

    it('idempotency digest covers assignmentRevision/expectedRoundIndex/restoreGeneration/sorted householdIds: any of those changing rejects a replay under the same key', async () => {
      const runFirst = async (fake: ReturnType<typeof makeFakeFirestore>) => {
        setUpFakeHouseholds(fake)
        return writeHouseholdCheckpointV3({ firestore: fake as never, ...baseInput, visibleConcepts: [...baseInput.visibleConcepts] })
      }

      // assignmentRevision differs
      const fakeRevision = makeFakeFirestore()
      await runFirst(fakeRevision)
      await expect(
        writeHouseholdCheckpointV3({
          firestore: fakeRevision as never, ...baseInput, assignmentRevision: 8, visibleConcepts: [...baseInput.visibleConcepts],
        }),
      ).rejects.toThrow('Idempotency key payload mismatch')

      // expectedRoundIndex differs
      const fakeRound = makeFakeFirestore()
      await runFirst(fakeRound)
      await expect(
        writeHouseholdCheckpointV3({
          firestore: fakeRound as never, ...baseInput, expectedRoundIndex: 2, visibleConcepts: [...baseInput.visibleConcepts],
        }),
      ).rejects.toThrow('Idempotency key payload mismatch')

      // restoreGeneration differs (read from the LessonRun doc, not passed as input)
      const fakeGeneration = makeFakeFirestore()
      await runFirst(fakeGeneration)
      fakeGeneration.docs.set('lessonRuns/run-1', { restoreGeneration: 1 })
      await expect(
        writeHouseholdCheckpointV3({
          firestore: fakeGeneration as never, ...baseInput, visibleConcepts: [...baseInput.visibleConcepts],
        }),
      ).rejects.toThrow('Idempotency key payload mismatch')

      // sorted householdIds differ
      const fakeIds = makeFakeFirestore()
      await runFirst(fakeIds)
      fakeIds.docs.set('lessonRuns/run-1/households/hh-c', makeHousehold('hh-c', 'team-3') as unknown as Record<string, unknown>)
      await expect(
        writeHouseholdCheckpointV3({
          firestore: fakeIds as never, ...baseInput, householdIds: ['hh-a', 'hh-b', 'hh-c'], visibleConcepts: [...baseInput.visibleConcepts],
        }),
      ).rejects.toThrow('Idempotency key payload mismatch')
    })

    it('replays same key with the same payload, returning the original checkpointId without re-reading household mutations', async () => {
      const fake = makeFakeFirestore()
      setUpFakeHouseholds(fake)

      const first = await writeHouseholdCheckpointV3({ firestore: fake as never, ...baseInput, visibleConcepts: [...baseInput.visibleConcepts] })

      fake.docs.set('lessonRuns/run-1/households/hh-a', { ...makeHousehold('hh-a', 'team-1'), cashYen: 9999999 } as unknown as Record<string, unknown>)

      const second = await writeHouseholdCheckpointV3({
        firestore: fake as never, ...baseInput, nowMillis: 3000, visibleConcepts: [...baseInput.visibleConcepts],
      })

      expect(second.created).toBe(false)
      expect(second.checkpointId).toBe(first.checkpointId)
    })
  })
})
