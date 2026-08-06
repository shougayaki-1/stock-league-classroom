export interface MembershipChange {
  orgId: string
  uid: string
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
  revokedAtSeconds: number
}

export interface SyncOrganizationMembershipChangeDeps {
  markMirrorPending: (orgId: string, membershipVersion: number) => Promise<void>
  updateFirestoreMembership: (change: MembershipChange) => Promise<void>
  commitMirrorSynced: (change: MembershipChange) => Promise<void>
}

/**
 * Grant, suspend, and role-change flows all pass through this single
 * function — no other path writes the RTDB mirror directly. Marking the
 * mirror meta PENDING before touching Firestore means that any failure
 * between here and the final commit denies the affected member's RTDB read
 * rather than serving a stale mirror; other members are unaffected because
 * only their own orgAccessMeta entry moves to PENDING. A retry with the same
 * membershipVersion re-runs all three steps and converges to SYNCED.
 */
export const syncOrganizationMembershipChange = async (
  deps: SyncOrganizationMembershipChangeDeps,
  change: MembershipChange,
): Promise<void> => {
  await deps.markMirrorPending(change.orgId, change.membershipVersion)
  await deps.updateFirestoreMembership(change)
  await deps.commitMirrorSynced(change)
}
