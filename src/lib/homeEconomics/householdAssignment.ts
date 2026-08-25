import { httpsCallable, type Functions } from 'firebase/functions'

/** Mirrors `@stock-league/household-authoring-content`'s `CourseFormat` — duplicated here rather than imported, matching this directory's existing convention of not importing functions-only packages into client code (see `teacherDashboard.ts`). */
export type CourseFormat = 'COMMON_CONDITIONS' | 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'

export interface HouseholdAssignmentWarning {
  code: string
  message: string
}

export interface HouseholdAssignmentConfig {
  courseFormat: CourseFormat
  state: 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number
  teamSetFingerprint: string
  entryIds: string[]
  entriesDigest: string
  lastEditedByUid: string
  lastEditedAtServerMillis: number
  frozenByUid?: string
  frozenAtServerMillis?: number
}

export interface HouseholdAssignmentView {
  lessonRunId: string
  courseFormat: CourseFormat
  state: 'UNPREPARED' | 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number | null
  warnings: HouseholdAssignmentWarning[]
  teams: Array<{
    teamId: string
    teamDisplayName: string
    entries: Array<{
      householdId: string
      profileId: string
      profileSummary: {
        lifeStage: string
        family: string
      } | null
      displayOrder: number
      assignmentSource: 'AUTO' | 'MANUAL'
    }>
  }>
}

export interface GetHouseholdAssignmentInput {
  lessonRunId: string
}

export interface PrepareHouseholdAssignmentInput {
  lessonRunId: string
  idempotencyKey: string
}

export interface UpdateHouseholdAssignmentInput {
  lessonRunId: string
  expectedRevision: number
  changes: Array<{
    householdId: string
    profileId?: string
    displayOrder?: number
  }>
  idempotencyKey: string
}

export const getHouseholdAssignment = async (
  functions: Functions,
  input: GetHouseholdAssignmentInput,
): Promise<HouseholdAssignmentView> => {
  const callable = httpsCallable<GetHouseholdAssignmentInput, HouseholdAssignmentView>(
    functions,
    'getHouseholdAssignmentCallable',
  )
  const result = await callable(input)
  return result.data
}

export const prepareHouseholdAssignment = async (
  functions: Functions,
  input: PrepareHouseholdAssignmentInput,
): Promise<HouseholdAssignmentView> => {
  const callable = httpsCallable<PrepareHouseholdAssignmentInput, HouseholdAssignmentView>(
    functions,
    'prepareHouseholdAssignmentCallable',
  )
  const result = await callable(input)
  return result.data
}

export const updateHouseholdAssignment = async (
  functions: Functions,
  input: UpdateHouseholdAssignmentInput,
): Promise<HouseholdAssignmentView> => {
  const callable = httpsCallable<UpdateHouseholdAssignmentInput, HouseholdAssignmentView>(
    functions,
    'updateHouseholdAssignmentCallable',
  )
  const result = await callable(input)
  return result.data
}
