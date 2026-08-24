import { httpsCallable, type Functions } from 'firebase/functions'

export interface SaveTeamResearchNoteInput {
  lessonRunId: string
  teamId: string
  text: string
  expectedRevision: number
  idempotencyKey: string
}

export interface SaveTeamResearchNoteResult {
  revision: number
  deduplicated: boolean
}

export const saveTeamResearchNote = async (
  functions: Functions,
  input: SaveTeamResearchNoteInput,
): Promise<SaveTeamResearchNoteResult> => {
  const callable = httpsCallable<SaveTeamResearchNoteInput, SaveTeamResearchNoteResult>(
    functions,
    'saveTeamResearchNoteCallable',
  )
  const result = await callable(input)
  return result.data
}

export type SaveTeamResearchNoteErrorCode =
  | 'REVISION_CONFLICT'
  | 'UNKNOWN'

interface FunctionsLikeError {
  code?: unknown
}

export const mapSaveTeamResearchNoteError = (
  error: unknown,
): SaveTeamResearchNoteErrorCode => {
  const code = (error as FunctionsLikeError | null | undefined)?.code
  return code === 'functions/aborted' ? 'REVISION_CONFLICT' : 'UNKNOWN'
}
