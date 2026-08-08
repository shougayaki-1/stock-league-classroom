import { getDatabase } from 'firebase-admin/database'
import { activeParticipantStatuses, type LessonRunMembershipMirror } from '@stock-league/lesson-runtime-types'
import type { LessonParticipant } from './participants/repository'

/**
 * Only the fields `syncLessonRunMembership` actually reads to build the
 * mirror. Narrowed from the full `LessonParticipant` (rather than requiring
 * every field, e.g. `displayName`/`identityMode`/`joinedAt`/`lastSeenAt`
 * that this function never touches) so a caller that already has these
 * specific values in hand — e.g. `joinLessonRun.ts`'s production wiring,
 * which computes them inside its own Firestore transaction — can pass them
 * straight through instead of performing a redundant extra Firestore read
 * just to reconstruct a full `LessonParticipant` object. A real
 * `LessonParticipant` still satisfies this type structurally, so existing
 * callers (checkpoint/participant flows) are unaffected.
 */
export type MembershipMirrorParticipant = Pick<
  LessonParticipant,
  'id' | 'lessonRunId' | 'orgId' | 'authUid' | 'teamId' | 'status' | 'sessionVersion'
>

export interface SyncLessonRunMembershipInput {
  participant: MembershipMirrorParticipant
  /**
   * Not carried on `LessonParticipant` itself — the caller (a future
   * join/leave/status-change Callable, Task 3+) supplies the current
   * lesson-run membership version, the same way Phase A's
   * `syncOrganizationMembershipChange` threads `membershipVersion` in from
   * its caller rather than deriving it from the participant record.
   *
   * NOTE: unlike Phase A's orgAccess/orgAccessMeta pair, this value is not
   * currently checked by any RTDB rule — see the JSDoc on
   * `LessonRunMembershipMirror.membershipVersion` in
   * `@stock-league/lesson-runtime-types` for why that is safe today and
   * what a future task needs to decide.
   */
  membershipVersion: number
  /**
   * Escape hatch for a caller that needs this mirror entry's `access` to
   * diverge from what `participant.status` would normally derive — e.g.
   * device recovery (recovery.ts), where the old-UID mirror must become
   * REVOKED even though the participant's real Firestore status at that
   * instant is the transient (and itself "active") `MIGRATING_DEVICE`, not
   * anything suspension-like. When supplied, it is used verbatim as
   * `mirror.access` instead of deriving it from
   * `activeParticipantStatuses.includes(participant.status)`.
   *
   * This must NEVER be used to fabricate `mirror.participantStatus` — that
   * field always reflects the real `participant.status`, override or not,
   * so the RTDB mirror stays truthful even when its `access` is being
   * forced. (Before this option existed, the only way to force `access` to
   * REVOKED was to pass a fake `participant.status` — see recovery.ts's
   * git history / task-4-report.md Critical #1 for why that was wrong.)
   */
  accessOverride?: LessonRunMembershipMirror['access']
}

export interface SyncLessonRunMembershipDeps {
  setMirror: (lessonRunId: string, authUid: string, mirror: LessonRunMembershipMirror) => Promise<void>
  now?: () => number
}

/**
 * Firestore (`LessonParticipant`, the system of record) -> RTDB
 * (`lessonRunMembership/{lessonRunId}/{authUid}`, the mirror the RTDB Rules
 * trust). `setMirror` always does a full replace (`set()`), never a partial
 * `update()` — the mirror must never accumulate stale fields from a prior
 * team assignment or status.
 *
 * A suspended (or otherwise non-active) participant is mirrored with
 * `access: 'REVOKED'`, not deleted: RTDB Rules fail closed on both a
 * missing entry and a REVOKED one, but only the latter is auditable —
 * matching Phase A's orgAccess mirror, which also expresses revocation as a
 * state transition rather than a deletion.
 */
export const syncLessonRunMembership = async (
  deps: SyncLessonRunMembershipDeps,
  input: SyncLessonRunMembershipInput,
): Promise<LessonRunMembershipMirror> => {
  const { participant, membershipVersion, accessOverride } = input
  const access: LessonRunMembershipMirror['access'] =
    accessOverride ?? (activeParticipantStatuses.includes(participant.status) ? 'ACTIVE' : 'REVOKED')

  const mirror: LessonRunMembershipMirror = {
    orgId: participant.orgId,
    participantId: participant.id,
    ...(participant.teamId !== undefined ? { teamId: participant.teamId } : {}),
    access,
    participantStatus: participant.status,
    membershipVersion,
    sessionVersion: participant.sessionVersion,
    updatedAtMillis: deps.now ? deps.now() : Date.now(),
  }

  await deps.setMirror(participant.lessonRunId, participant.authUid, mirror)
  return mirror
}

/** Production wiring: RTDB Admin SDK. Admin SDK is the only writer of this mirror. */
export const syncLessonRunMembershipWithAdminSdk = (
  input: SyncLessonRunMembershipInput,
): Promise<LessonRunMembershipMirror> =>
  syncLessonRunMembership({
    setMirror: async (lessonRunId, authUid, mirror) => {
      await getDatabase().ref(`lessonRunMembership/${lessonRunId}/${authUid}`).set(mirror)
    },
  }, input)
