/**
 * Client-side mirror of functions/src/lessonRuns/authorization.ts. Duplicated
 * here for the same reason every other client wrapper in this directory
 * duplicates a server-side type (see transitionPhase.ts's `LessonRunStatus`,
 * liveRepository's client-side interventions.ts's `LessonInterventionType`
 * comment) — functions/ and src/ do not share a types module today. Keep
 * byte-for-byte identical to the server file if either changes.
 */
export type LessonRunRole = 'PRIMARY' | 'ASSISTANT' | 'VIEWER'

export type LessonControlAction =
  | 'START_LESSON'
  | 'END_LESSON'
  | 'STOP_MARKET'
  | 'CHANGE_SETTINGS'
  | 'TRANSFER_PRIMARY'
  | 'TRANSITION_PHASE'
  | 'PUBLISH_NOTICE'
  | 'EXTEND_TIME'
  | 'SUPPORT_STUDENT'
  | 'HANDLE_CONNECTION'
  | 'VIEW_PROGRESS'
  | 'VIEW_RESULTS'

export const lessonControlPermissions: Record<LessonControlAction, LessonRunRole[]> = {
  START_LESSON: ['PRIMARY'],
  END_LESSON: ['PRIMARY'],
  STOP_MARKET: ['PRIMARY'],
  CHANGE_SETTINGS: ['PRIMARY'],
  TRANSFER_PRIMARY: ['PRIMARY'],
  TRANSITION_PHASE: ['PRIMARY'],
  PUBLISH_NOTICE: ['PRIMARY', 'ASSISTANT'],
  EXTEND_TIME: ['PRIMARY', 'ASSISTANT'],
  SUPPORT_STUDENT: ['PRIMARY', 'ASSISTANT'],
  HANDLE_CONNECTION: ['PRIMARY', 'ASSISTANT'],
  VIEW_PROGRESS: ['PRIMARY', 'ASSISTANT', 'VIEWER'],
  VIEW_RESULTS: ['PRIMARY', 'ASSISTANT', 'VIEWER'],
}

export const canControlLesson = (role: LessonRunRole, action: LessonControlAction): boolean =>
  lessonControlPermissions[action].includes(role)
