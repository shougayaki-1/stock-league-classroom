import { httpsCallable, type Functions } from 'firebase/functions'

export interface PurgeSchoolOrgInput { orgId: string }

export const purgeSchoolOrg = async (
  functions: Functions,
  input: PurgeSchoolOrgInput,
  generateIdempotencyKey: () => string = () => crypto.randomUUID(),
): Promise<void> => {
  await httpsCallable<Record<string, unknown>, void>(functions, 'purgeSchoolOrgCallable')({
    orgId: input.orgId, confirm: true, confirmOrgId: input.orgId, idempotencyKey: generateIdempotencyKey(),
  })
}
