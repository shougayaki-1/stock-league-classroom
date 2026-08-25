import { describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase/firestore'

const collectionMock = vi.fn((_firestore: unknown, path: string) => ({ __path: path }))
const onSnapshotMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  onSnapshot: onSnapshotMock,
}))

const { subscribeLessonTeams } = await import('./teams')

describe('subscribeLessonTeams', () => {
  it('subscribes to lessonRuns/{lessonRunId}/teams and forwards each doc as a LessonTeamView', () => {
    let capturedNext: ((snapshot: { docs: Array<{ data: () => unknown }> }) => void) | undefined
    onSnapshotMock.mockImplementationOnce((_ref, onNext) => { capturedNext = onNext; return () => {} })
    const onUpdate = vi.fn()
    const firestore = {} as Firestore

    subscribeLessonTeams(firestore, 'run-1', onUpdate)

    expect(collectionMock).toHaveBeenCalledWith(firestore, 'lessonRuns/run-1/teams')
    const team = { id: 't-1', displayName: 'Aチーム', memberParticipantIds: ['p-1'], confirmationMode: 'ALL' as const }
    capturedNext?.({ docs: [{ data: () => team }] })
    expect(onUpdate).toHaveBeenCalledWith([team])
  })

  it('returns the Firestore-supplied unsubscribe function', () => {
    const detach = vi.fn()
    onSnapshotMock.mockImplementationOnce(() => detach)
    const unsubscribe = subscribeLessonTeams({} as Firestore, 'run-1', vi.fn())
    unsubscribe()
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('forwards errors to the optional onError callback', () => {
    let capturedError: ((error: Error) => void) | undefined
    onSnapshotMock.mockImplementationOnce((_ref, _onNext, onError) => { capturedError = onError; return () => {} })
    const onError = vi.fn()
    subscribeLessonTeams({} as Firestore, 'run-1', vi.fn(), onError)
    const err = new Error('permission denied')
    capturedError?.(err)
    expect(onError).toHaveBeenCalledWith(err)
  })
})
