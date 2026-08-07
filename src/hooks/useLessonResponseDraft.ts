import { useCallback, useEffect, useRef, useState } from 'react'
import type { Functions } from 'firebase/functions'
import type { LessonInputValue } from '@stock-league/lesson-inputs'
import { saveResponseDraft as saveResponseDraftDefault, type SaveResponseDraftInput, type SaveResponseDraftResult } from '../lib/lessonRuns/responses'

const DEFAULT_DEBOUNCE_MS = 500

const defaultCreateIdempotencyKey = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export type LessonResponseDraftStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

export interface UseLessonResponseDraftInput {
  functions: Functions
  lessonRunId: string
  participantId?: string
  teamId?: string
  phaseId: string
  inputId: string
  initialValue: LessonInputValue
  /** Revision the caller already knows about (e.g. from a prior fetch). Defaults to 0 — no draft saved yet. */
  initialRevision?: number
  /** Debounce delay in ms before an edit is auto-saved. Defaults to 500 (task-7-brief's "変更後500msで一度だけ保存"). */
  debounceMs?: number
  /** Injectable for tests; defaults to the real saveResponseDraft Callable wrapper. */
  saveResponseDraft?: (functions: Functions, input: SaveResponseDraftInput) => Promise<SaveResponseDraftResult>
  /** Injectable for tests; defaults to crypto.randomUUID. Each debounced save gets a fresh key — a genuinely new autosave attempt, matching saveResponse.ts's design note. */
  createIdempotencyKey?: () => string
}

export interface UseLessonResponseDraftResult {
  value: LessonInputValue
  /** Updates the local value and (re)starts the debounce timer; does not save synchronously. */
  setValue: (value: LessonInputValue) => void
  status: LessonResponseDraftStatus
  /** The last revision this hook knows to be persisted (or reconciled from the server). Used as `expectedRevision` on the next save. */
  revision: number
  error: unknown
  /** Saves immediately, bypassing the debounce timer. Safe to call when there is nothing pending (resolves immediately). */
  flush: () => Promise<void>
  /**
   * Called when a fresh authoritative (revision, value) pair arrives from
   * the server — e.g. after reconnecting or a snapshot listener update.
   * If there is no unsaved local edit, adopts it outright. If there IS an
   * unsaved local edit and the server's revision has moved past what this
   * hook last knew, the local edit is kept (never silently overwritten —
   * "通信失敗時にローカルdraftを保持" applies here too) but `status` becomes
   * 'conflict' and the known revision is still updated, so the next save
   * uses the correct `expectedRevision` instead of failing as stale.
   */
  reconcileRevision: (serverRevision: number, serverValue: LessonInputValue) => void
}

/**
 * Auto-saves a lesson response draft: debounces local edits, saves via the
 * saveResponseDraft Callable, keeps the local draft on a failed save (never
 * reverts the user's typing), and flushes any pending save before unmount
 * so a fast navigate-away never silently drops the last edit.
 */
export const useLessonResponseDraft = (input: UseLessonResponseDraftInput): UseLessonResponseDraftResult => {
  const {
    functions, lessonRunId, participantId, teamId, phaseId, inputId,
    initialValue, initialRevision = 0, debounceMs = DEFAULT_DEBOUNCE_MS,
    saveResponseDraft = saveResponseDraftDefault,
    createIdempotencyKey = defaultCreateIdempotencyKey,
  } = input

  const [value, setValueState] = useState<LessonInputValue>(initialValue)
  const [status, setStatus] = useState<LessonResponseDraftStatus>('idle')
  const [error, setError] = useState<unknown>(undefined)

  // Refs (not state) for everything the debounce timer / flush need to read
  // synchronously without stale-closure risk — this hook intentionally
  // avoids re-running the scheduling effect on every keystroke.
  const revisionRef = useRef(initialRevision)
  const [revision, setRevisionDisplay] = useState(initialRevision)
  const valueRef = useRef(value)
  valueRef.current = value
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savingRef = useRef<Promise<void> | undefined>(undefined)

  const setRevision = (next: number) => {
    revisionRef.current = next
    setRevisionDisplay(next)
  }

  const performSave = useCallback(async (): Promise<void> => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    const valueToSave = valueRef.current
    const expectedRevisionAtSaveTime = revisionRef.current
    setStatus('saving')
    const save = (async () => {
      try {
        const result = await saveResponseDraft(functions, {
          lessonRunId,
          participantId,
          teamId,
          phaseId,
          inputId,
          value: valueToSave,
          expectedRevision: expectedRevisionAtSaveTime > 0 ? expectedRevisionAtSaveTime : undefined,
          idempotencyKey: createIdempotencyKey(),
        })
        setRevision(result.revision)
        setError(undefined)
        // A newer edit may have arrived while this save was in flight — if
        // so, leave it marked dirty so the next debounce/flush picks it up
        // instead of being reported as 'saved' prematurely.
        setStatus(dirtyRef.current ? 'idle' : 'saved')
      } catch (saveError) {
        // Communication failure: keep the local draft (never revert
        // `value`/`valueRef`) and re-mark dirty so a later flush/edit
        // retries the save instead of silently losing it.
        dirtyRef.current = true
        setError(saveError)
        setStatus('error')
      }
    })()
    savingRef.current = save
    await save
    savingRef.current = undefined
  }, [functions, lessonRunId, participantId, teamId, phaseId, inputId, saveResponseDraft, createIdempotencyKey])

  const setValue = useCallback((next: LessonInputValue) => {
    valueRef.current = next
    dirtyRef.current = true
    setValueState(next)
    setStatus('idle')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      void performSave()
    }, debounceMs)
  }, [debounceMs, performSave])

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    if (savingRef.current) await savingRef.current
    if (dirtyRef.current) await performSave()
  }, [performSave])

  const reconcileRevision = useCallback((serverRevision: number, serverValue: LessonInputValue) => {
    if (!dirtyRef.current) {
      setRevision(serverRevision)
      valueRef.current = serverValue
      setValueState(serverValue)
      return
    }
    if (serverRevision > revisionRef.current) {
      setRevision(serverRevision)
      setStatus('conflict')
    }
  }, [])

  // Unmount-flush: fires the last pending debounced save (if any) rather
  // than dropping it. Fire-and-forget is intentional — React effect cleanup
  // cannot be awaited, and the underlying Callable call is idempotent
  // (fresh idempotencyKey per attempt, expectedRevision-guarded) so letting
  // it complete after unmount is safe.
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
      if (dirtyRef.current) void performSave()
    }
  }, [performSave])

  return { value, setValue, status, revision, error, flush, reconcileRevision }
}
