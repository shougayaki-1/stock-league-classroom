import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { ping } from './ping'
export { ensurePersonalOrgCallable } from './organizations/onCall'
export { publishLessonVersionCallable } from './lessonTemplates/onCall'
export { createLessonRunCallable, restoreCheckpointCallable } from './lessonRuns/onCall'
export {
  assignParticipantToTeamCallable,
  issueRecoveryCodeCallable,
  joinLessonRunCallable,
  recoverParticipantCallable,
  rotateRepresentativeCallable,
} from './lessonRuns/participants/onCall'
export { transitionPhaseCallable } from './lessonRuns/phases/onCall'
export {
  abortLessonCallable,
  completeLessonCallable,
  interruptLessonCallable,
  resumeLessonCallable,
} from './lessonRuns/lifecycle/onCall'
export {
  confirmResponseCallable,
  decideProposalCallable,
  saveResponseDraftCallable,
  submitProposalCallable,
} from './lessonRuns/responses/onCall'
export {
  applyTeacherInterventionCallable,
  transferPrimaryTeacherCallable,
} from './lessonRuns/interventions/onCall'
export {
  exchangeDisplaySessionTokenCallable,
  issueDisplaySessionTokenCallable,
} from './lessonRuns/projections/onCall'
export { submitSurveyCallable } from './lessonRuns/surveys/onCall'
export {
  exportPersonalDataCallable,
  purgeHardDeleteCallable,
  purgePersonalOrganizationCallable,
  requestSoftDeleteCallable,
  restoreSoftDeletedCallable,
} from './privacy/onCall'
export { purgeExpiredSoftDeletesScheduled } from './privacy/purgeExpiredSoftDeletes'
