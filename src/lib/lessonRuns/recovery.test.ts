import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Mocks the module boundary (not the Functions instance), matching
// joinLessonRun.test.ts/checkpoint.test.ts — a plain fake `functions`
// object throws when passed to the real `httpsCallable`.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { issueRecoveryCode, recoverParticipant, mapRecoveryError } = await import('./recovery')

describe('issueRecoveryCode (client)', () => {
  it('calls issueRecoveryCodeCallable with the wire-shaped input and returns the plaintext code', async () => {
    callable.mockResolvedValue({ data: { code: 'ABCDEFGHJK', deduplicated: false } })
    const functions = {} as Functions

    const result = await issueRecoveryCode(functions, { lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'issue-1' })

    expect(result).toEqual({ code: 'ABCDEFGHJK', deduplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'issueRecoveryCodeCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'issue-1' })
  })
})

describe('recoverParticipant (client)', () => {
  it('calls recoverParticipantCallable with the wire-shaped input, never sending an authUid', async () => {
    callable.mockResolvedValue({
      data: {
        participantId: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', oldAuthUid: 'old-uid', newAuthUid: 'new-uid',
        previousStatus: 'ACTIVE', sessionVersion: 2, membershipVersion: 5, deduplicated: false,
      },
    })
    const functions = {} as Functions

    const result = await recoverParticipant(functions, { lessonRunId: 'run-1', code: 'ABCDEFGHJK', idempotencyKey: 'recover-1' })

    expect(result.newAuthUid).toBe('new-uid')
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'recoverParticipantCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', code: 'ABCDEFGHJK', idempotencyKey: 'recover-1' })
    expect(callable).not.toHaveBeenCalledWith(expect.objectContaining({ authUid: expect.anything() }))
  })
})

describe('mapRecoveryError', () => {
  it.each([
    ['functions/unauthenticated', 'UNAUTHENTICATED'],
    ['functions/invalid-argument', 'INVALID_INPUT'],
    ['functions/permission-denied', 'PERMISSION_DENIED'],
    ['functions/not-found', 'CODE_NOT_FOUND'],
    ['functions/failed-precondition', 'CODE_ALREADY_USED_OR_EXPIRED'],
    // Distinct from CODE_ALREADY_USED_OR_EXPIRED: this is "retrying
    // issueRecoveryCode with an idempotencyKey that already issued a code
    // cannot be replayed" (the plaintext was never persisted, so there is
    // nothing to hand back) — not "the recovery code itself is invalid".
    // The UI needs to tell these apart (e.g. "もう一度お試しください" vs
    // "コードは既に使用済みか期限切れです"), so the Callable boundary maps
    // them to different HttpsError codes; see participants/onCall.ts's
    // translateRecoveryError.
    ['functions/already-exists', 'RECOVERY_CODE_ALREADY_ISSUED'],
  ] as const)('maps %s to %s', (code, expected) => {
    expect(mapRecoveryError({ code })).toBe(expected)
  })

  it('maps an unrecognized code to UNKNOWN', () => {
    expect(mapRecoveryError({ code: 'functions/internal' })).toBe('UNKNOWN')
  })

  it('maps a non-Functions error (e.g. a plain network failure) to UNKNOWN instead of throwing', () => {
    expect(mapRecoveryError(new TypeError('network error'))).toBe('UNKNOWN')
    expect(mapRecoveryError(undefined)).toBe('UNKNOWN')
  })
})
