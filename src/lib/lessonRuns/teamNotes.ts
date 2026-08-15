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
