import { httpsCallable, type Functions } from 'firebase/functions'

export interface CreateSchoolOrgInput {
  name: string
}

export interface CreateSchoolOrgResult {
  orgId: string
}

export const createSchoolOrg = async (
  functions: Functions,
  input: CreateSchoolOrgInput,
): Promise<CreateSchoolOrgResult> =>
  (await httpsCallable<CreateSchoolOrgInput, CreateSchoolOrgResult>(functions, 'createSchoolOrgCallable')(input)).data
