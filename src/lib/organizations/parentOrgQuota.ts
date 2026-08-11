import { httpsCallable, type Functions } from 'firebase/functions'

export interface QuotaAxisUsage {
  guaranteed: number
  usage: number
  reserved: number
}

export interface ParentQuotaSummary {
  limit: number
  guaranteed: number
  sharedAvailable: number
  reserved: number
}

export interface ParentOrgQuotaUsageInput {
  parentOrgId: string
}

export interface ParentOrgQuotaSchoolUsage {
  schoolOrgId: string
  concurrentLessonsAndMarkets: QuotaAxisUsage
  teacherSeats: QuotaAxisUsage
}

export interface ParentOrgQuotaUsageResult {
  parentOrgId: string
  concurrentLessonsAndMarkets: ParentQuotaSummary
  teacherSeats: ParentQuotaSummary
  schools: ParentOrgQuotaSchoolUsage[]
}

export interface SchoolEffectiveQuotaInput {
  schoolOrgId: string
}

export interface SchoolEffectiveQuotaAxis {
  guaranteed: number
  usage: number
  sharedReserved: number
  effectiveAvailable: number
}

export interface SchoolEffectiveQuotaResult {
  schoolOrgId: string
  parentOrgId: string
  concurrentLessonsAndMarkets: SchoolEffectiveQuotaAxis
  teacherSeats: SchoolEffectiveQuotaAxis
}

export type GetParentOrgQuotaUsageInput = ParentOrgQuotaUsageInput
export type GetParentOrgQuotaUsageResult = ParentOrgQuotaUsageResult
export type GetSchoolEffectiveQuotaInput = SchoolEffectiveQuotaInput
export type GetSchoolEffectiveQuotaResult = SchoolEffectiveQuotaResult

export interface SetSchoolQuotaAllocationInput {
  parentOrgId: string
  schoolOrgId: string
  guaranteedConcurrentLessonsAndMarkets: number
  guaranteedTeacherSeats: number
}

export const getParentOrgQuotaUsage = async (
  functions: Functions,
  input: ParentOrgQuotaUsageInput,
): Promise<ParentOrgQuotaUsageResult> => (
  await httpsCallable<ParentOrgQuotaUsageInput, ParentOrgQuotaUsageResult>(functions, 'getParentOrgQuotaUsageCallable')(input)
).data

export const getSchoolEffectiveQuota = async (
  functions: Functions,
  input: SchoolEffectiveQuotaInput,
): Promise<SchoolEffectiveQuotaResult> => (
  await httpsCallable<SchoolEffectiveQuotaInput, SchoolEffectiveQuotaResult>(functions, 'getSchoolEffectiveQuotaCallable')(input)
).data

export const setSchoolQuotaAllocation = async (
  functions: Functions,
  input: SetSchoolQuotaAllocationInput,
): Promise<void> => {
  await httpsCallable<SetSchoolQuotaAllocationInput, unknown>(functions, 'setSchoolQuotaAllocationCallable')(input)
}
