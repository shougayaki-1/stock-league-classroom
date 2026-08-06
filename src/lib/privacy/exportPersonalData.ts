import { httpsCallable, type Functions } from 'firebase/functions'

export interface PersonalDataExport {
  exportedAt: string
  uid: string
  orgId: string
  user: Record<string, unknown> | null
  organization: Record<string, unknown> | null
  membership: Record<string, unknown> | null
  orgAccessMirror: Record<string, unknown> | null
  orgAccessMeta: Record<string, unknown> | null
  lessonTemplates: Record<string, unknown>[]
  lessonRuns: Record<string, unknown>[]
}

/**
 * Client wrapper for the exportPersonalDataCallable Callable. Takes no
 * input — orgId is always resolved server-side from the caller's uid, never
 * sent by the client (see functions/src/privacy/onCall.ts). Returns the
 * exported JSON only; turning that into a downloadable Blob is UI work,
 * explicitly out of scope for Phase A.
 */
export const exportPersonalData = async (functions: Functions): Promise<PersonalDataExport> => {
  const callable = httpsCallable<undefined, PersonalDataExport>(functions, 'exportPersonalDataCallable')
  const result = await callable()
  return result.data
}
