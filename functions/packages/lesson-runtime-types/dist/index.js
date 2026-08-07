"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canParticipantOperate = exports.activeParticipantStatuses = void 0;
exports.activeParticipantStatuses = [
    'ACTIVE', 'TEMPORARILY_DISCONNECTED', 'LATE_JOIN', 'MIGRATING_DEVICE', 'OBSERVER',
];
const canParticipantOperate = (status) => status === 'ACTIVE' || status === 'LATE_JOIN';
exports.canParticipantOperate = canParticipantOperate;
