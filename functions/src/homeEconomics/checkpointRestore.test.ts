import { describe, expect, it } from 'vitest'
import type { HouseholdState } from '../lessonRuns/households/repository'
import { buildHouseholdCheckpointSnapshot, restoreHouseholdsFromSnapshot } from './checkpointRestore'

const household: HouseholdState = {
  householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 1500000,
  assetHoldingsYen: { DOMESTIC_STOCK: 800000 }, activeInsuranceContracts: { 'ins-1': 7 },
  activeLiabilities: { 'loan-1': { remainingPrincipalYen: 18000000, remainingYears: 15, annualInterestRatePercent: 2 } },
  lifeStage: 'CHILD_REARING', roundIndex: 4, goalDelayedRounds: 1, updatedAtServerMillis: 1234,
}

describe('buildHouseholdCheckpointSnapshot / restoreHouseholdsFromSnapshot', () => {
  it('round-trips every household field exactly (spec §13.18: 版と乱数シード固定と同じ厳密性)', () => {
    const snapshot = buildHouseholdCheckpointSnapshot([household])
    const restored = restoreHouseholdsFromSnapshot(snapshot)
    expect(restored).toEqual([household])
  })

  it('round-trips multiple households independently, never mixing state between them', () => {
    const other: HouseholdState = { ...household, householdId: 'case-c', cashYen: 999999, roundIndex: 1 }
    const snapshot = buildHouseholdCheckpointSnapshot([household, other])
    const restored = restoreHouseholdsFromSnapshot(snapshot)
    expect(restored).toHaveLength(2)
    expect(restored.find((h) => h.householdId === 'case-b')?.cashYen).toBe(1500000)
    expect(restored.find((h) => h.householdId === 'case-c')?.cashYen).toBe(999999)
  })

  it('throws a clear error if snapshot has an unknown schemaVersion (e.g. 2 or 99)', () => {
    const snapshotWithVersion2 = { schemaVersion: 2, households: [household] }
    expect(() => restoreHouseholdsFromSnapshot(snapshotWithVersion2)).toThrow(
      'Unknown household checkpoint schema version: 2'
    )

    const snapshotWithVersion99 = { schemaVersion: 99, households: [household] }
    expect(() => restoreHouseholdsFromSnapshot(snapshotWithVersion99)).toThrow(
      'Unknown household checkpoint schema version: 99'
    )
  })
})
