export type ParticipantId = string;
export type TeamId = string;
export type ParticipantStatus = 'ACTIVE' | 'TEMPORARILY_DISCONNECTED' | 'ABSENT' | 'OBSERVER' | 'LATE_JOIN' | 'MIGRATING_DEVICE' | 'SUSPENDED';
export type LessonRunRole = 'PRIMARY' | 'ASSISTANT' | 'VIEWER';
export interface LessonRunMembershipMirror {
    orgId: string;
    participantId: ParticipantId;
    teamId?: TeamId;
    access: 'ACTIVE' | 'REVOKED';
    participantStatus: ParticipantStatus;
    /**
     * Stored for future use, but NOT currently enforced by any RTDB rule.
     * Unlike Phase A's orgAccess/orgAccessMeta pair — where `orgAccess` and
     * `orgAccessMeta` each carry a `membershipVersion` and the rules require
     * them to match before granting access — `lessonRunMembership` has no
     * companion meta node and no rule expression anywhere references this
     * field. Today, staleness is instead prevented because `access` itself is
     * read fresh from this mirror on every RTDB rule evaluation (students
     * never carry a cached authorization in their token), so an immediate
     * revoke still takes effect. This is not a security hole, but it means
     * `membershipVersion` is presently inert data. A future task (Task 3:
     * join codes / idempotent join, or later) needs to decide who increments
     * this value and whether a version-consistency check analogous to
     * orgAccess/orgAccessMeta should be introduced for this mirror too.
     */
    membershipVersion: number;
    sessionVersion: number;
    updatedAtMillis: number;
}
export declare const activeParticipantStatuses: ParticipantStatus[];
export declare const canParticipantOperate: (status: ParticipantStatus) => boolean;
