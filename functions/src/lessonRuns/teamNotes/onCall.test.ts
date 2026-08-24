import { describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import { handleSaveTeamResearchNote } from './onCall'
import { TeamNoteRevisionConflictError } from './saveTeamNote'

describe('handleSaveTeamResearchNote', () => {
  const defaultRequest = {
    lessonRunId: 'run-1',
    teamId: 'team-1',
    text: 'Note content',
    expectedRevision: 0,
    idempotencyKey: 'key-1',
  }

  it('throws unauthenticated if auth is missing', async () => {
    await expect(handleSaveTeamResearchNote({
      auth: null,
      data: defaultRequest,
    }, {
      resolveActorParticipantId: vi.fn(),
      requireTeamMembership: vi.fn(),
      saveTeamNoteFn: vi.fn(),
    })).rejects.toThrow(HttpsError)
  })

  it('throws invalid-argument if fields are missing or invalid', async () => {
    const deps = {
      resolveActorParticipantId: vi.fn(),
      requireTeamMembership: vi.fn(),
      saveTeamNoteFn: vi.fn(),
    }

    await expect(handleSaveTeamResearchNote({
      auth: { uid: 'u1' } as never,
      data: { ...defaultRequest, text: '' },
    }, deps)).rejects.toThrow(HttpsError)

    await expect(handleSaveTeamResearchNote({
      auth: { uid: 'u1' } as never,
      data: { ...defaultRequest, expectedRevision: -1 },
    }, deps)).rejects.toThrow(HttpsError)
  })

  it('checks participant resolution and team membership', async () => {
    const resolveActorParticipantId = vi.fn().mockResolvedValue('p1')
    const requireTeamMembership = vi.fn().mockRejectedValue(new HttpsError('permission-denied', 'このチームのメンバーではありません。'))
    const saveTeamNoteFn = vi.fn()

    await expect(handleSaveTeamResearchNote({
      auth: { uid: 'u1' } as never,
      data: defaultRequest,
    }, {
      resolveActorParticipantId,
      requireTeamMembership,
      saveTeamNoteFn,
    })).rejects.toThrow('このチームのメンバーではありません。')

    expect(resolveActorParticipantId).toHaveBeenCalledWith('run-1', 'u1')
    expect(requireTeamMembership).toHaveBeenCalledWith('run-1', 'team-1', 'p1')
    expect(saveTeamNoteFn).not.toHaveBeenCalled()
  })

  it('calls saveTeamNoteFn and returns result on success', async () => {
    const resolveActorParticipantId = vi.fn().mockResolvedValue('p1')
    const requireTeamMembership = vi.fn().mockResolvedValue(undefined)
    const saveTeamNoteFn = vi.fn().mockResolvedValue({ revision: 1, deduplicated: false })

    const result = await handleSaveTeamResearchNote({
      auth: { uid: 'u1' } as never,
      data: defaultRequest,
    }, {
      resolveActorParticipantId,
      requireTeamMembership,
      saveTeamNoteFn,
    })

    expect(result).toEqual({ revision: 1, deduplicated: false })
    expect(saveTeamNoteFn).toHaveBeenCalledWith(defaultRequest)
  })

  it('translates a revision conflict to the stable aborted callable code', async () => {
    const saveTeamNoteFn = vi.fn().mockRejectedValue(new TeamNoteRevisionConflictError())

    try {
      await handleSaveTeamResearchNote({
        auth: { uid: 'u1' } as never,
        data: defaultRequest,
      }, {
        resolveActorParticipantId: vi.fn().mockResolvedValue('p1'),
        requireTeamMembership: vi.fn().mockResolvedValue(undefined),
        saveTeamNoteFn,
      })
      throw new Error('expected conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpsError)
      expect((error as HttpsError).code).toBe('aborted')
      expect((error as HttpsError).message).not.toContain('Revision mismatch')
    }
  })
})
