import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { saveTeamResearchNote } = await import('./teamNotes')

describe('saveTeamResearchNote', () => {
  it('calls httpsCallable with saveTeamResearchNoteCallable and returns response data', async () => {
    callable.mockResolvedValue({
      data: { revision: 2, deduplicated: false },
    })

    const fakeFunctions = {} as Functions
    const input = {
      lessonRunId: 'run-1',
      teamId: 'team-1',
      text: 'Test note',
      expectedRevision: 1,
      idempotencyKey: 'key-1',
    }

    const result = await saveTeamResearchNote(fakeFunctions, input)

    expect(httpsCallable).toHaveBeenCalledWith(fakeFunctions, 'saveTeamResearchNoteCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual({ revision: 2, deduplicated: false })
  })

  it('maps functions/aborted to the semantic revision-conflict code', async () => {
    const { mapSaveTeamResearchNoteError } = await import('./teamNotes')

    expect(mapSaveTeamResearchNoteError({ code: 'functions/aborted' })).toBe(
      'REVISION_CONFLICT',
    )
  })

  it('never classifies by backend message text', async () => {
    const { mapSaveTeamResearchNoteError } = await import('./teamNotes')

    expect(mapSaveTeamResearchNoteError(new Error('Revision mismatch'))).toBe('UNKNOWN')
    expect(mapSaveTeamResearchNoteError({
      code: 'functions/internal',
      message: 'Revision mismatch',
    })).toBe('UNKNOWN')
  })
})
