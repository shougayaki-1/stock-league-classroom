import { describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase/firestore'

const collectionMock = vi.fn((_firestore: unknown, path: string) => ({ __path: path }))
const onSnapshotMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  onSnapshot: onSnapshotMock,
}))

const { subscribeLessonResponses } = await import('./teacherResponses')

describe('subscribeLessonResponses', () => {
  it('subscribes to lessonRuns/{lessonRunId}/responses and forwards each doc as a LessonResponseView, unmodified', () => {
    let capturedNext: ((snapshot: { docs: Array<{ data: () => unknown }> }) => void) | undefined
    onSnapshotMock.mockImplementationOnce((_ref, onNext) => { capturedNext = onNext; return () => {} })
    const onUpdate = vi.fn()
    const firestore = {} as Firestore

    subscribeLessonResponses(firestore, 'run-1', onUpdate)

    expect(collectionMock).toHaveBeenCalledWith(firestore, 'lessonRuns/run-1/responses')
    const response = { id: 'r-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', status: 'APPROVED' as const }
    capturedNext?.({ docs: [{ data: () => response }] })
    expect(onUpdate).toHaveBeenCalledWith([response])
  })

  it('returns the Firestore-supplied unsubscribe function', () => {
    const detach = vi.fn()
    onSnapshotMock.mockImplementationOnce(() => detach)
    const unsubscribe = subscribeLessonResponses({} as Firestore, 'run-1', vi.fn())
    unsubscribe()
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('forwards errors to the optional onError callback', () => {
    let capturedError: ((error: Error) => void) | undefined
    onSnapshotMock.mockImplementationOnce((_ref, _onNext, onError) => { capturedError = onError; return () => {} })
    const onError = vi.fn()
    subscribeLessonResponses({} as Firestore, 'run-1', vi.fn(), onError)
    const err = new Error('permission denied')
    capturedError?.(err)
    expect(onError).toHaveBeenCalledWith(err)
  })
})
