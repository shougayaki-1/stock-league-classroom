import { describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase/firestore'

const collectionMock = vi.fn((_firestore: unknown, path: string) => ({ __path: path }))
const onSnapshotMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  onSnapshot: onSnapshotMock,
}))

const { subscribeLessonParticipants } = await import('./participants')

describe('subscribeLessonParticipants', () => {
  it('subscribes to lessonRuns/{lessonRunId}/participants and forwards each doc as a LessonParticipantView', () => {
    let capturedNext: ((snapshot: { docs: Array<{ data: () => unknown }> }) => void) | undefined
    onSnapshotMock.mockImplementationOnce((_ref, onNext) => { capturedNext = onNext; return () => {} })
    const onUpdate = vi.fn()
    const firestore = {} as Firestore

    subscribeLessonParticipants(firestore, 'run-1', onUpdate)

    expect(collectionMock).toHaveBeenCalledWith(firestore, 'lessonRuns/run-1/participants')
    const participant = { id: 'p-1', displayName: '山田太郎', status: 'ACTIVE' }
    capturedNext?.({ docs: [{ data: () => participant }] })
    expect(onUpdate).toHaveBeenCalledWith([participant])
  })

  it('returns the Firestore-supplied unsubscribe function', () => {
    const detach = vi.fn()
    onSnapshotMock.mockImplementationOnce(() => detach)
    const unsubscribe = subscribeLessonParticipants({} as Firestore, 'run-1', vi.fn())
    unsubscribe()
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('forwards errors to the optional onError callback', () => {
    let capturedError: ((error: Error) => void) | undefined
    onSnapshotMock.mockImplementationOnce((_ref, _onNext, onError) => { capturedError = onError; return () => {} })
    const onError = vi.fn()
    subscribeLessonParticipants({} as Firestore, 'run-1', vi.fn(), onError)
    const err = new Error('permission denied')
    capturedError?.(err)
    expect(onError).toHaveBeenCalledWith(err)
  })
})
