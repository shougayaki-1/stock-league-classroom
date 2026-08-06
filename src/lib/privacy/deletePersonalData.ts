import { httpsCallable, type Functions } from 'firebase/functions'

export interface RequestSoftDeleteInput { path: string; reason: string }
export interface RequestSoftDeleteResult { path: string }

/**
 * Client wrapper for requestSoftDeleteCallable — spec §21.3 priority 4's
 * "教師の誤操作 → 30日復元" self-service path. orgId is never sent by the
 * client; the server derives and verifies it from the target document
 * itself (see functions/src/privacy/onCall.ts).
 */
export const requestSoftDelete = async (functions: Functions, input: RequestSoftDeleteInput): Promise<RequestSoftDeleteResult> => {
  const callable = httpsCallable<RequestSoftDeleteInput, RequestSoftDeleteResult>(functions, 'requestSoftDeleteCallable')
  const result = await callable(input)
  return result.data
}

export interface RestoreSoftDeletedInput { path: string }
export interface RestoreSoftDeletedResult { path: string }

/** Client wrapper for restoreSoftDeletedCallable — undoes requestSoftDelete within its 30-day window. */
export const restoreSoftDeleted = async (functions: Functions, input: RestoreSoftDeletedInput): Promise<RestoreSoftDeletedResult> => {
  const callable = httpsCallable<RestoreSoftDeletedInput, RestoreSoftDeletedResult>(functions, 'restoreSoftDeletedCallable')
  const result = await callable(input)
  return result.data
}

export interface PurgeHardDeleteInput { path: string; confirm: true; confirmTargetId: string; idempotencyKey: string }
export interface PurgeHardDeleteResult { operationId: string; completed: boolean; alreadyCompleted: boolean }

/**
 * Client wrapper for purgeHardDeleteCallable — the formal, immediate,
 * no-restore complete-deletion path (spec §21.3 priority 1, §26-9). Must
 * never be wired to the same UI control as requestSoftDelete: it requires
 * `confirm: true` and re-entering the target's own id as `confirmTargetId`,
 * which this wrapper deliberately does not default or infer from `path`.
 */
export const purgeHardDelete = async (functions: Functions, input: PurgeHardDeleteInput): Promise<PurgeHardDeleteResult> => {
  const callable = httpsCallable<PurgeHardDeleteInput, PurgeHardDeleteResult>(functions, 'purgeHardDeleteCallable')
  const result = await callable(input)
  return result.data
}

export interface PurgePersonalOrganizationInput { confirm: true; confirmUid: string; idempotencyKey: string }
export interface PurgePersonalOrganizationResult { operationId: string; completed: boolean; alreadyCompleted: boolean }

/**
 * Client wrapper for purgePersonalOrganizationCallable — the formal,
 * immediate, no-restore whole-personal-org deletion request. orgId is never
 * sent by the client; the server always derives it as personalOrgId(uid).
 * Requires `confirm: true` and re-entering the caller's own uid as
 * `confirmUid` as proof of intent, plus a fresh sign-in server-side.
 */
export const purgePersonalOrganization = async (
  functions: Functions,
  input: PurgePersonalOrganizationInput,
): Promise<PurgePersonalOrganizationResult> => {
  const callable = httpsCallable<PurgePersonalOrganizationInput, PurgePersonalOrganizationResult>(functions, 'purgePersonalOrganizationCallable')
  const result = await callable(input)
  return result.data
}
