import { httpsCallable, type Functions } from 'firebase/functions'

export type AiBetaUiState = 'LOADING' | 'APPROVED' | 'LOCKED' | 'ERROR'

export interface AiBetaAccessListItem {
  teacherUid: string
  email: string
  approvedByUid: string
  approvedAtMillis: number
}

export const getMyAiBetaAccess = async (
  functions: Functions,
): Promise<{ approved: boolean }> => {
  const callable = httpsCallable<void, { approved: boolean }>(
    functions,
    'getMyAiBetaAccessCallable',
  )
  const result = await callable()
  return result.data
}

export const listAiBetaAccess = async (
  functions: Functions,
): Promise<AiBetaAccessListItem[]> => {
  const callable = httpsCallable<void, AiBetaAccessListItem[]>(
    functions,
    'listAiBetaAccessCallable',
  )
  const result = await callable()
  return result.data
}

export const grantAiBetaAccess = async (
  functions: Functions,
  input: { email: string; reason: string; idempotencyKey: string },
): Promise<{ changed: boolean; teacherUid: string }> => {
  const callable = httpsCallable<
    { email: string; reason: string; idempotencyKey: string },
    { changed: boolean; teacherUid: string }
  >(functions, 'grantAiBetaAccessCallable')
  const result = await callable(input)
  return result.data
}

export const revokeAiBetaAccess = async (
  functions: Functions,
  input: { teacherUid: string; reason: string; idempotencyKey: string },
): Promise<{ changed: boolean; teacherUid: string }> => {
  const callable = httpsCallable<
    { teacherUid: string; reason: string; idempotencyKey: string },
    { changed: boolean; teacherUid: string }
  >(functions, 'revokeAiBetaAccessCallable')
  const result = await callable(input)
  return result.data
}
