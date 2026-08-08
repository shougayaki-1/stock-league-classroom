import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'
import { useLessonResponseDraft } from './useLessonResponseDraft'

const functions = {} as Functions
const baseScope = { functions, lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1' }

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useLessonResponseDraft', () => {
  it('saves exactly once, 500ms after the value changes, with the latest value', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false })
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', saveResponseDraft }))

    act(() => { result.current.setValue('a') })
    expect(saveResponseDraft).not.toHaveBeenCalled()

    // Edits within the debounce window reset the timer — only one save fires, with the latest value.
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    act(() => { result.current.setValue('ab') })
    await act(async () => { await vi.advanceTimersByTimeAsync(499) })
    expect(saveResponseDraft).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(saveResponseDraft).toHaveBeenCalledTimes(1)
    expect(saveResponseDraft).toHaveBeenCalledWith(functions, expect.objectContaining({ value: 'ab' }))
  })

  it('does not save again if the value never changes', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false })
    renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: 'x', saveResponseDraft }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(saveResponseDraft).not.toHaveBeenCalled()
  })

  it('updates revision and status to saved after a successful save', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 5, status: 'DRAFT', deduplicated: false })
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', saveResponseDraft }))
    act(() => { result.current.setValue('a') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.status).toBe('saved')
    expect(result.current.revision).toBe(5)
  })

  it('keeps the local draft and marks status "error" when the save fails', async () => {
    const saveResponseDraft = vi.fn().mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', saveResponseDraft }))
    act(() => { result.current.setValue('unsaved edit') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.status).toBe('error')
    // The local draft is not reverted — the user's edit is still visible/editable.
    expect(result.current.value).toBe('unsaved edit')
  })

  it('retries a failed save on flush, and succeeds if the retry does', async () => {
    const saveResponseDraft = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false })
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', saveResponseDraft }))
    act(() => { result.current.setValue('a') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.status).toBe('error')

    await act(async () => { await result.current.flush() })
    expect(saveResponseDraft).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('flushes a pending debounced save immediately when flush() is called before the timer fires', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 2, status: 'DRAFT', deduplicated: false })
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', saveResponseDraft }))
    act(() => { result.current.setValue('a') })
    await act(async () => { await result.current.flush() })
    expect(saveResponseDraft).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saved')
  })

  it('flushes the pending save before unmount instead of dropping it', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false })
    const { result, unmount } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', saveResponseDraft }))
    act(() => { result.current.setValue('a') })
    expect(saveResponseDraft).not.toHaveBeenCalled()

    unmount()
    // Fire-and-forget on unmount: let the microtask queue drain.
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(saveResponseDraft).toHaveBeenCalledTimes(1)
  })

  it('reconcileRevision adopts the server value/revision when there is no pending local edit', () => {
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', initialRevision: 1 }))
    act(() => { result.current.reconcileRevision(3, 'server value') })
    expect(result.current.revision).toBe(3)
    expect(result.current.value).toBe('server value')
    expect(result.current.status).not.toBe('conflict')
  })

  it('reconcileRevision keeps the local unsaved edit but flags a conflict when the server has moved ahead', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false })
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', initialRevision: 1, saveResponseDraft }))
    act(() => { result.current.setValue('my unsaved edit') })
    act(() => { result.current.reconcileRevision(4, 'someone elses newer value') })
    expect(result.current.value).toBe('my unsaved edit')
    expect(result.current.status).toBe('conflict')
    expect(result.current.revision).toBe(4)
  })

  // Important #2: unmount must flush a dirty draft even when the timer has
  // already fired once (and cleared itself) — not only while a debounce
  // timer is still pending.
  it('flushes an unsaved edit on unmount even after a save already failed once and re-armed dirty (no pending timer)', async () => {
    const saveResponseDraft = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false })
    const { result, unmount } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', saveResponseDraft }))

    act(() => { result.current.setValue('a') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current.status).toBe('error')
    expect(saveResponseDraft).toHaveBeenCalledTimes(1)

    // At this point the debounce timer already fired and cleared itself
    // (timerRef.current is undefined), but dirtyRef is true again because
    // the save failed. Unmounting here must not silently drop the edit.
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(saveResponseDraft).toHaveBeenCalledTimes(2)
  })

  // Important #3: the unmount cleanup must not fire early just because
  // `performSave`'s identity changes across renders (e.g. because the
  // caller passes inline `saveResponseDraft`/`createIdempotencyKey`
  // functions with a fresh reference on every render).
  it('does not fire a save on re-render even when unstable saveResponseDraft/createIdempotencyKey references are passed every render', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false })
    const { result, rerender } = renderHook(
      () => useLessonResponseDraft({
        ...baseScope,
        initialValue: '',
        // New function reference every render — this used to make
        // `performSave`'s identity change every render too.
        saveResponseDraft: (...args: Parameters<typeof saveResponseDraft>) => saveResponseDraft(...args),
        createIdempotencyKey: () => `${Date.now()}-${Math.random()}`,
      }),
    )

    act(() => { result.current.setValue('a') })
    // Re-render several times within the debounce window — if the unmount
    // cleanup re-ran on identity change, this would flush the save early.
    rerender()
    rerender()
    rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(499) })
    expect(saveResponseDraft).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(saveResponseDraft).toHaveBeenCalledTimes(1)
  })

  // Important #4: performSave must not let two saves race — a save
  // triggered while one is already in flight must wait for it, so it
  // reads the freshly-confirmed revision instead of a stale one.
  it('waits for an in-flight save to finish before starting the next one, using the freshly-confirmed revision', async () => {
    let resolveFirst!: (value: { responseId: string; revision: number; status: 'DRAFT'; deduplicated: boolean }) => void
    const firstSave = new Promise<{ responseId: string; revision: number; status: 'DRAFT'; deduplicated: boolean }>((resolve) => { resolveFirst = resolve })
    const saveResponseDraft = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ responseId: 'r', revision: 2, status: 'DRAFT', deduplicated: false })

    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', initialRevision: 1, saveResponseDraft }))

    act(() => { result.current.setValue('a') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(saveResponseDraft).toHaveBeenCalledTimes(1)
    // The first save is still in flight (its promise has not resolved).

    // A second edit arrives and its debounce fires while the first save is
    // still pending.
    act(() => { result.current.setValue('b') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    // The second save must not have started yet — it has to wait for the
    // first one to resolve.
    expect(saveResponseDraft).toHaveBeenCalledTimes(1)

    await act(async () => { resolveFirst({ responseId: 'r', revision: 1, status: 'DRAFT', deduplicated: false }) })
    // Once the first save resolves, the queued second save proceeds using
    // the just-confirmed revision (1), not the stale revision from before
    // the first save started.
    expect(saveResponseDraft).toHaveBeenCalledTimes(2)
    expect(saveResponseDraft).toHaveBeenLastCalledWith(functions, expect.objectContaining({ value: 'b', expectedRevision: 1 }))
    expect(result.current.status).toBe('saved')
    expect(result.current.revision).toBe(2)
  })

  // Important #5: once a conflict is detected, auto-save must stop instead
  // of silently saving further local edits against the server's newer
  // revision.
  it('stops auto-saving once reconcileRevision flags a conflict', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r', revision: 99, status: 'DRAFT', deduplicated: false })
    const { result } = renderHook(() => useLessonResponseDraft({ ...baseScope, initialValue: '', initialRevision: 1, saveResponseDraft }))

    act(() => { result.current.setValue('my unsaved edit') })
    act(() => { result.current.reconcileRevision(4, 'someone elses newer value') })
    expect(result.current.status).toBe('conflict')

    // Further local edits still update the value locally...
    act(() => { result.current.setValue('yet another edit') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    // ...but must never trigger an automatic save while in conflict.
    expect(saveResponseDraft).not.toHaveBeenCalled()

    // Even an explicit flush must not silently overwrite the server value.
    await act(async () => { await result.current.flush() })
    expect(saveResponseDraft).not.toHaveBeenCalled()
  })
})
