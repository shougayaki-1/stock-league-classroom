import { httpsCallable, type Functions } from 'firebase/functions'

export interface EnsurePersonalOrgResult { orgId: string; created: boolean }

export const ensurePersonalOrg = async (functions: Functions): Promise<EnsurePersonalOrgResult> => {
  const call = httpsCallable<void, EnsurePersonalOrgResult>(functions, 'ensurePersonalOrgCallable')
  const result = await call()
  return result.data
}
