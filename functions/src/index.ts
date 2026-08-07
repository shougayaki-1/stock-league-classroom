import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { ping } from './ping'
export { ensurePersonalOrgCallable } from './organizations/onCall'
export { publishLessonVersionCallable } from './lessonTemplates/onCall'
export { createLessonRunCallable, restoreCheckpointCallable } from './lessonRuns/onCall'
export { joinLessonRunCallable } from './lessonRuns/participants/onCall'
export { transitionPhaseCallable } from './lessonRuns/phases/onCall'
export {
  exportPersonalDataCallable,
  purgeHardDeleteCallable,
  purgePersonalOrganizationCallable,
  requestSoftDeleteCallable,
  restoreSoftDeletedCallable,
} from './privacy/onCall'
export { purgeExpiredSoftDeletesScheduled } from './privacy/purgeExpiredSoftDeletes'
