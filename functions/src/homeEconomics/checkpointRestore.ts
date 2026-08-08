import type { HouseholdState } from '../lessonRuns/households/repository'

/** The `snapshot: unknown` payload Phase A's `writeCheckpoint` (checkpoint.ts) stores — home economics' own shape, opaque to the generic checkpoint machinery. */
export interface HouseholdCheckpointSnapshot {
  schemaVersion: 1
  households: HouseholdState[]
}

export const buildHouseholdCheckpointSnapshot = (households: HouseholdState[]): HouseholdCheckpointSnapshot => ({
  schemaVersion: 1,
  households: households.map((household) => ({ ...household })),
})

export const restoreHouseholdsFromSnapshot = (snapshot: HouseholdCheckpointSnapshot): HouseholdState[] =>
  snapshot.households.map((household) => ({ ...household }))
