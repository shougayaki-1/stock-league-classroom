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
})
