import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance,
// matching createLessonRun.test.ts/checkpoint.test.ts.
const callable = vi.fn().mockResolvedValue({
  data: { lessonRunId: 'run-1', participantId: 'p-1', duplicateIdentifierWarning: false, deduplicated: false },
})
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { joinLessonRun, mapJoinLessonRunError } = await import('./joinLessonRun')

describe('joinLessonRun (client)', () => {
  it('calls the joinLessonRunCallable callable with only the wire-shaped input', async () => {
    const functions = {} as Functions
    const result = await joinLessonRun(functions, {
      joinCode: 'ABCDEF', identityMode: 'QUICK_JOIN', displayName: 'たろう', idempotencyKey: 'join-1',
    })
    expect(result).toEqual({ lessonRunId: 'run-1', participantId: 'p-1', duplicateIdentifierWarning: false, deduplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'joinLessonRunCallable')
    expect(callable).toHaveBeenCalledWith({
      joinCode: 'ABCDEF', identityMode: 'QUICK_JOIN', displayName: 'たろう', idempotencyKey: 'join-1',
    })
  })

  it('passes externalIdentifier through when provided', async () => {
    const functions = {} as Functions
    await joinLessonRun(functions, {
      joinCode: 'ABCDEF', identityMode: 'SCHOOL_ACCOUNT', displayName: 'はなこ',
      externalIdentifier: '15', idempotencyKey: 'join-2',
    })
    expect(callable).toHaveBeenCalledWith({
      joinCode: 'ABCDEF', identityMode: 'SCHOOL_ACCOUNT', displayName: 'はなこ',
      externalIdentifier: '15', idempotencyKey: 'join-2',
    })
  })
})

describe('mapJoinLessonRunError', () => {
  it.each([
    ['functions/unauthenticated', 'UNAUTHENTICATED'],
    ['functions/invalid-argument', 'INVALID_INPUT'],
    ['functions/not-found', 'JOIN_CODE_NOT_FOUND'],
    ['functions/failed-precondition', 'LESSON_NOT_ACCEPTING_PARTICIPANTS'],
    ['functions/resource-exhausted', 'LESSON_FULL'],
    ['functions/permission-denied', 'PARTICIPANT_SUSPENDED'],
  ] as const)('maps %s to %s', (code, expected) => {
    expect(mapJoinLessonRunError({ code })).toBe(expected)
  })

  it('maps an unrecognized code to UNKNOWN', () => {
    expect(mapJoinLessonRunError({ code: 'functions/internal' })).toBe('UNKNOWN')
  })

  it('maps a non-Functions error (e.g. a plain network failure) to UNKNOWN instead of throwing', () => {
    expect(mapJoinLessonRunError(new TypeError('network error'))).toBe('UNKNOWN')
    expect(mapJoinLessonRunError(undefined)).toBe('UNKNOWN')
  })
})
