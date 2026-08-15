import { describe, expect, it, vi } from 'vitest'
import { saveTeamNote, type SaveTeamNoteDeps } from './saveTeamNote'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  const reads: string[] = []
  return {
    docs,
    reads,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          reads.push(path)
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
      })
    },
  }
}

describe('saveTeamNote', () => {
  it('saves initial note (expectedRevision = 0 -> revision = 1) and updates RTDB mirror', async () => {
    const fake = makeFakeFirestore()
    const updateRealtimeNote = vi.fn().mockResolvedValue(undefined)
    const deps: SaveTeamNoteDeps = {
      firestore: fake as never,
      updateRealtimeNote,
      now: () => 1_000,
    }

    const result = await saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: 'Our initial research notes',
      expectedRevision: 0,
      idempotencyKey: 'key-1',
    })

    expect(result).toEqual({ revision: 1, deduplicated: false })
    const noteDoc = fake.docs.get('lessonRuns/run-1/teamNotes/team-a')
    expect(noteDoc).toMatchObject({
      text: 'Our initial research notes',
      revision: 1,
      updatedAtMillis: 1_000,
    })
    expect(updateRealtimeNote).toHaveBeenCalledWith('run-1', 'team-a', {
      text: 'Our initial research notes',
      revision: 1,
      updatedAtMillis: 1_000,
    })
  })

  it('increments revision when expectedRevision matches current revision', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamNotes/team-a', {
      text: 'First version',
      revision: 1,
      updatedAtMillis: 500,
    })
    const updateRealtimeNote = vi.fn().mockResolvedValue(undefined)
    const deps: SaveTeamNoteDeps = {
      firestore: fake as never,
      updateRealtimeNote,
      now: () => 2_000,
    }

    const result = await saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: 'Updated version',
      expectedRevision: 1,
      idempotencyKey: 'key-2',
    })

    expect(result).toEqual({ revision: 2, deduplicated: false })
    expect(updateRealtimeNote).toHaveBeenCalledWith('run-1', 'team-a', {
      text: 'Updated version',
      revision: 2,
      updatedAtMillis: 2_000,
    })
  })

  it('rejects when expectedRevision does not match current revision (conflict)', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamNotes/team-a', {
      text: 'First version',
      revision: 2,
      updatedAtMillis: 500,
    })
    const updateRealtimeNote = vi.fn().mockResolvedValue(undefined)
    const deps: SaveTeamNoteDeps = {
      firestore: fake as never,
      updateRealtimeNote,
      now: () => 2_000,
    }

    await expect(saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: 'Conflicting update',
      expectedRevision: 1, // Mismatch: server has 2
      idempotencyKey: 'key-3',
    })).rejects.toThrow('Revision mismatch')

    expect(updateRealtimeNote).not.toHaveBeenCalled()
  })

  it('handles idempotency replay: same key + same payload returns cached revision without rewriting', async () => {
    const fake = makeFakeFirestore()
    const updateRealtimeNote = vi.fn().mockResolvedValue(undefined)
    const deps: SaveTeamNoteDeps = {
      firestore: fake as never,
      updateRealtimeNote,
      now: () => 1_000,
    }

    const first = await saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: 'Idempotent text',
      expectedRevision: 0,
      idempotencyKey: 'key-4',
    })
    expect(first).toEqual({ revision: 1, deduplicated: false })

    const second = await saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: 'Idempotent text',
      expectedRevision: 0,
      idempotencyKey: 'key-4',
    })
    expect(second).toEqual({ revision: 1, deduplicated: true })
    // Realtime update should have been called once for initial save, or safe retry
    expect(updateRealtimeNote).toHaveBeenCalledTimes(1)
  })

  it('rejects idempotency key mismatch when same key is used with different payload', async () => {
    const fake = makeFakeFirestore()
    const updateRealtimeNote = vi.fn().mockResolvedValue(undefined)
    const deps: SaveTeamNoteDeps = {
      firestore: fake as never,
      updateRealtimeNote,
      now: () => 1_000,
    }

    await saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: 'First payload',
      expectedRevision: 0,
      idempotencyKey: 'key-5',
    })

    await expect(saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: 'Different payload',
      expectedRevision: 0,
      idempotencyKey: 'key-5',
    })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('validates text length: rejects empty/whitespace text and text > 5000 chars', async () => {
    const fake = makeFakeFirestore()
    const deps: SaveTeamNoteDeps = {
      firestore: fake as never,
      updateRealtimeNote: vi.fn(),
      now: () => 1_000,
    }

    await expect(saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: '   ',
      expectedRevision: 0,
      idempotencyKey: 'key-empty',
    })).rejects.toThrow('ノートは1文字以上5000文字以内で入力してください。')

    const longText = 'a'.repeat(5001)
    await expect(saveTeamNote(deps, {
      lessonRunId: 'run-1',
      teamId: 'team-a',
      text: longText,
      expectedRevision: 0,
      idempotencyKey: 'key-long',
    })).rejects.toThrow('ノートは1文字以上5000文字以内で入力してください。')
  })
})
