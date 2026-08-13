import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { ping } from './ping'
export { createStripeCheckoutSessionCallable } from './billing/onCall'
export { createStripeCustomerPortalSessionCallable } from './billing/onCall'
export {
  getBillingOverviewCallable,
  saveBillingProfileCallable,
  startInvoiceSubscriptionCallable,
} from './billing/onCall'
export { stripeWebhookCallable } from './billing/stripeWebhook'
export {
  ensurePersonalOrgCallable,
  createSchoolOrgCallable,
  createInvitationCallable,
  acceptInvitationCallable,
  listMyInvitationsCallable,
  getOrgPlanLimitsCallable,
  listOrgMembersCallable,
  suspendOrgMemberCallable,
  createParentOrgCallable,
  linkSchoolToParentOrgCallable,
  unlinkSchoolFromParentOrgCallable,
  listChildSchoolsCallable,
} from './organizations/onCall'
export {
  getParentOrgQuotaUsageCallable,
  getSchoolEffectiveQuotaCallable,
  setSchoolQuotaAllocationCallable,
} from './organizations/parentOrgQuotaOnCall'
export { migrateSchoolFromEndedParentCallable } from './organizations/parentContractMigrationOnCall'
export { generateLessonDraftCallable, generateTeacherGuidanceCallable } from './ai/onCall'
export { getTuningConstantsCallable } from './platformConfig/onCall'
export { duplicateLessonTemplateCallable, publishLessonVersionCallable } from './lessonTemplates/onCall'
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
  setTeacherGuidanceCallable,
} from './lessonRuns/projections/onCall'
export { submitSurveyCallable } from './lessonRuns/surveys/onCall'
export {
  cancelOrderCallable,
  pauseMarketCallable,
  resumeMarketCallable,
  submitOrderCallable,
  submitPredictionCallable,
  triggerBankruptcyCallable,
} from './market/onCall'
export {
  processRoundCallable,
  restoreHouseholdCheckpointCallable,
  submitHouseholdDecisionCallable,
  writeHouseholdCheckpointCallable,
} from './homeEconomics/onCall'
export { batchTaskQueue } from './market/taskHandler'
export { resumeTaskQueue } from './market/resumeMarket'
export { chainWatchdogScheduled } from './market/chainWatchdog'
export {
  exportPersonalDataCallable,
  purgeHardDeleteCallable,
  purgePersonalOrganizationCallable,
  requestSoftDeleteCallable,
  restoreSoftDeletedCallable,
} from './privacy/onCall'
export { purgeExpiredSoftDeletesScheduled } from './privacy/purgeExpiredSoftDeletes'
