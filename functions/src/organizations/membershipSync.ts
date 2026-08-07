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
 *
 * Intentionally has no `*WithAdminSdk` sibling and no Callable wired to it
 * yet, unlike (e.g.) createLessonRunWithAdminSdk. This is deliberate, not an
 * oversight: Phase A has no membership-mutation Callable — suspend,
 * role-change, and promote/demote flows are Phase B+ scope. This function
 * exists now as a ready-made, already-tested primitive so that (a) Finding
 * 1's fix to ensurePersonalOrg has a documented counterpart describing whose
 * job the RTDB mirror's ongoing state actually is, and (b) whichever future
 * task implements suspend/role-change can call this directly instead of
 * re-deriving the PENDING -> update -> SYNCED ordering. When that task lands,
 * it should add the Admin SDK wiring and Callable here rather than
 * duplicating this logic elsewhere.
 */
export const syncOrganizationMembershipChange = async (
  deps: SyncOrganizationMembershipChangeDeps,
  change: MembershipChange,
): Promise<void> => {
  await deps.markMirrorPending(change.orgId, change.membershipVersion)
  await deps.updateFirestoreMembership(change)
  await deps.commitMirrorSynced(change)
}
