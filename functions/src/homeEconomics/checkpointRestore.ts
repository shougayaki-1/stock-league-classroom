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

export const restoreHouseholdsFromSnapshot = (snapshot: unknown): HouseholdState[] => {
  // Validate schema version at runtime, matching the strictness pattern of
  // computeTaxAndSocialInsurance and per spec §13.18 ("版と乱数シード固定と同じ厳密性")
  if (typeof snapshot !== 'object' || snapshot === null || !('schemaVersion' in snapshot)) {
    throw new Error('Invalid household checkpoint snapshot: missing schemaVersion')
  }
  const snapshotData = snapshot as Record<string, unknown>
  if (snapshotData.schemaVersion !== 1) {
    throw new Error(`Unknown household checkpoint schema version: ${snapshotData.schemaVersion}`)
  }
  if (!Array.isArray(snapshotData.households)) {
    throw new Error('Invalid household checkpoint snapshot: households is not an array')
  }
  return (snapshotData.households as HouseholdState[]).map((household) => ({ ...household }))
}
