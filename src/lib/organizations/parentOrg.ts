import { httpsCallable, type Functions } from 'firebase/functions'
export interface CreateParentOrgInput { name: string }
export interface CreateParentOrgResult { orgId: string }
export const createParentOrg = async (functions: Functions, input: CreateParentOrgInput): Promise<CreateParentOrgResult> => (await httpsCallable<CreateParentOrgInput, CreateParentOrgResult>(functions, 'createParentOrgCallable')(input)).data
