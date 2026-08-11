import { httpsCallable, type Functions } from 'firebase/functions'
export interface ChildSchool {
  orgId: string
  name: string
  verificationStatus: string
  sharedReservationCount?: number
  unlinkBlockedReason?: string
}
export const linkSchoolToParentOrg = async (functions: Functions, input: { parentOrgId: string; schoolOrgId: string }): Promise<void> => { await httpsCallable<typeof input, void>(functions, 'linkSchoolToParentOrgCallable')(input) }
export const unlinkSchoolFromParentOrg = async (functions: Functions, input: { schoolOrgId: string }): Promise<void> => { await httpsCallable<typeof input, void>(functions, 'unlinkSchoolFromParentOrgCallable')(input) }
export const listChildSchools = async (functions: Functions, input: { parentOrgId: string }): Promise<ChildSchool[]> => (await httpsCallable<typeof input, ChildSchool[]>(functions, 'listChildSchoolsCallable')(input)).data
