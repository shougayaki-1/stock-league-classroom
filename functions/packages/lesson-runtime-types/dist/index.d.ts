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
    membershipVersion: number;
    sessionVersion: number;
    updatedAtMillis: number;
}
export declare const activeParticipantStatuses: ParticipantStatus[];
export declare const canParticipantOperate: (status: ParticipantStatus) => boolean;
