import { describe, expect, it, vi } from 'vitest'
import type { Database } from 'firebase/database'

const refMock = vi.fn((_database: unknown, path: string) => ({ __path: path }))
const onValueMock = vi.fn()
const offMock = vi.fn()

vi.mock('firebase/database', () => ({
  ref: refMock,
  onValue: onValueMock,
  off: offMock,
}))

const { subscribeDisplayRun, subscribeOwnTeamState, subscribePublicRun } = await import('./liveRepository')

describe('subscribePublicRun', () => {
  it('subscribes to lessonRunPublic/{lessonRunId} and forwards snapshot values', () => {
    let capturedListener: ((snapshot: { val: () => unknown }) => void) | undefined
    onValueMock.mockImplementationOnce((_ref, onNext) => { capturedListener = onNext; return () => {} })
    const onUpdate = vi.fn()
    const database = {} as Database

    subscribePublicRun(database, 'run-1', onUpdate)

    expect(refMock).toHaveBeenCalledWith(database, 'lessonRunPublic/run-1')
    expect(onValueMock).toHaveBeenCalledWith({ __path: 'lessonRunPublic/run-1' }, expect.any(Function), expect.any(Function))
    capturedListener?.({ val: () => ({ status: 'RUNNING' }) })
    expect(onUpdate).toHaveBeenCalledWith({ status: 'RUNNING' })
  })

  it('returns an unsubscribe function that detaches the listener exactly once (off), so the caller can always tear down a stale subscription on auth/membership change', () => {
    onValueMock.mockImplementationOnce(() => {})
    const unsubscribe = subscribePublicRun({} as Database, 'run-1', vi.fn())
    expect(offMock).not.toHaveBeenCalled()
    unsubscribe()
    expect(offMock).toHaveBeenCalledTimes(1)
    expect(offMock).toHaveBeenCalledWith({ __path: 'lessonRunPublic/run-1' }, 'value', expect.any(Function))
    unsubscribe()
    // Calling unsubscribe twice must not detach a second, unrelated listener.
    expect(offMock).toHaveBeenCalledTimes(1)
  })

  it('forwards errors to the optional onError callback instead of throwing', () => {
    let capturedErrorHandler: ((error: Error) => void) | undefined
    onValueMock.mockImplementationOnce((_ref, _onNext, onError) => { capturedErrorHandler = onError; return () => {} })
    const onError = vi.fn()
    subscribePublicRun({} as Database, 'run-1', vi.fn(), onError)
    const err = new Error('permission denied')
    capturedErrorHandler?.(err)
    expect(onError).toHaveBeenCalledWith(err)
  })
})

describe('subscribeOwnTeamState', () => {
  it('subscribes to lessonRunTeamState/{lessonRunId}/{teamId}', () => {
    onValueMock.mockImplementationOnce(() => () => {})
    const database = {} as Database
    subscribeOwnTeamState(database, 'run-1', 'team-a', vi.fn())
    expect(refMock).toHaveBeenCalledWith(database, 'lessonRunTeamState/run-1/team-a')
  })

  it('returns an independent unsubscribe function per call, so switching teams (e.g. after recovery) does not leave the old team listener attached', () => {
    onValueMock.mockImplementation(() => () => {})
    const database = {} as Database
    const unsubscribeA = subscribeOwnTeamState(database, 'run-1', 'team-a', vi.fn())
    const unsubscribeB = subscribeOwnTeamState(database, 'run-1', 'team-b', vi.fn())
    unsubscribeA()
    expect(offMock).toHaveBeenCalledWith({ __path: 'lessonRunTeamState/run-1/team-a' }, 'value', expect.any(Function))
    unsubscribeB()
    expect(offMock).toHaveBeenCalledWith({ __path: 'lessonRunTeamState/run-1/team-b' }, 'value', expect.any(Function))
  })
})

describe('subscribeDisplayRun', () => {
  it('subscribes to lessonRunDisplay/{lessonRunId}', () => {
    let capturedListener: ((snapshot: { val: () => unknown }) => void) | undefined
    onValueMock.mockImplementationOnce((_ref, onNext) => { capturedListener = onNext; return () => {} })
    const onUpdate = vi.fn()
    const database = {} as Database

    subscribeDisplayRun(database, 'run-1', onUpdate)

    expect(refMock).toHaveBeenCalledWith(database, 'lessonRunDisplay/run-1')
    capturedListener?.({ val: () => ({ mode: 'LIVE' }) })
    expect(onUpdate).toHaveBeenCalledWith({ mode: 'LIVE' })
  })

  it('unsubscribes via off on the display path', () => {
    onValueMock.mockImplementationOnce(() => () => {})
    const unsubscribe = subscribeDisplayRun({} as Database, 'run-1', vi.fn())
    unsubscribe()
    expect(offMock).toHaveBeenCalledWith({ __path: 'lessonRunDisplay/run-1' }, 'value', expect.any(Function))
  })
})
