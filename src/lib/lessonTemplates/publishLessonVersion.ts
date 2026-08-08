import { httpsCallable, type Functions } from 'firebase/functions'

export interface PublishLessonVersionInput {
  templateId: string
  changeSummary?: string
  idempotencyKey: string
}

export interface PublishLessonVersionResult {
  versionId: string
  alreadyPublished: boolean
}

/**
 * Client wrapper for the publishLessonVersionCallable Callable. Input is
 * limited to what the client actually knows — orgId is resolved server-side
 * from the template's own stored orgId, never sent by the client.
 */
export const publishLessonVersion = async (functions: Functions, input: PublishLessonVersionInput): Promise<PublishLessonVersionResult> => {
  const call = httpsCallable<PublishLessonVersionInput, PublishLessonVersionResult>(functions, 'publishLessonVersionCallable')
  const result = await call(input)
  return result.data
}
