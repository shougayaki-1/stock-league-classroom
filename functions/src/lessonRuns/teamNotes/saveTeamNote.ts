import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'

export class TeamNoteRevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT' as const

  constructor() {
    super('Team note revision conflict')
    this.name = 'TeamNoteRevisionConflictError'
  }
}

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

export interface TeamResearchNoteView {
  text: string
  revision: number
  updatedAtMillis: number
}

interface StoredIdempotency {
  requestDigest: string
  revision: number
}

export interface SaveTeamNoteDeps {
  firestore: {
    runTransaction: <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => Promise<T>
  }
  updateRealtimeNote: (
    lessonRunId: string,
    teamId: string,
    note: TeamResearchNoteView,
  ) => Promise<void>
  now?: () => number
}

export const saveTeamNote = async (
  deps: SaveTeamNoteDeps,
  input: SaveTeamResearchNoteInput,
): Promise<SaveTeamResearchNoteResult> => {
  const trimmed = input.text.trim()
  if (trimmed.length === 0 || input.text.length > 5000) {
    throw new Error('ノートは1文字以上5000文字以内で入力してください。')
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('expectedRevision は0以上の整数である必要があります。')
  }

  const nowMillis = deps.now ? deps.now() : Date.now()
  const idempotencyKeyId = idempotencyDocumentId(input.teamId, input.idempotencyKey)
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/teamNotes/${input.teamId}/saveNoteIdempotency/${idempotencyKeyId}`
  const requestDigest = computeRequestDigest({
    text: input.text,
    expectedRevision: input.expectedRevision,
  })
  const notePath = `lessonRuns/${input.lessonRunId}/teamNotes/${input.teamId}`

  const result = await deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const idempotencySnap = await tx.get(idempotencyPath)
    if (idempotencySnap.exists) {
      const prior = idempotencySnap.data() as unknown as StoredIdempotency
      if (prior.requestDigest !== requestDigest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return { revision: prior.revision, deduplicated: true }
    }

    const noteSnap = await tx.get(notePath)
    let currentRevision = 0
    if (noteSnap.exists) {
      const data = noteSnap.data() as { revision?: number }
      currentRevision = data.revision ?? 0
    }

    if (currentRevision !== input.expectedRevision) {
      throw new TeamNoteRevisionConflictError()
    }

    const newRevision = currentRevision + 1

    // ---- WRITE PHASE ----
    tx.set(notePath, {
      text: input.text,
      revision: newRevision,
      updatedAtMillis: nowMillis,
    })
    tx.set(idempotencyPath, {
      requestDigest,
      revision: newRevision,
      updatedAtMillis: nowMillis,
    })

    return { revision: newRevision, deduplicated: false }
  })

  if (!result.deduplicated) {
    await deps.updateRealtimeNote(input.lessonRunId, input.teamId, {
      text: input.text,
      revision: result.revision,
      updatedAtMillis: nowMillis,
    })
  }

  return result
}
