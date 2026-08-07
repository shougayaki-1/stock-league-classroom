import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Functions } from 'firebase/functions'
import type { Auth } from 'firebase/auth'

// Same module-boundary mock pattern as recovery.test.ts / checkpoint.test.ts:
// mock only the underlying firebase SDK calls, exercise the real wrappers.
const callable = vi.fn()
const httpsCallableMock = vi.fn(() => callable)
const signInWithCustomTokenMock = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: httpsCallableMock }))
vi.mock('firebase/auth', () => ({ signInWithCustomToken: signInWithCustomTokenMock }))

const { httpsCallable } = await import('firebase/functions')
const { signInWithCustomToken } = await import('firebase/auth')
const {
  issueDisplaySessionToken, exchangeDisplaySessionToken, signInForClassroomDisplay,
} = await import('./displaySession')

beforeEach(() => {
  callable.mockReset()
  httpsCallableMock.mockClear()
  signInWithCustomTokenMock.mockReset()
})

describe('issueDisplaySessionToken (client)', () => {
  it('calls issueDisplaySessionTokenCallable and returns the plaintext token', async () => {
    callable.mockResolvedValue({ data: { token: 'a'.repeat(64) } })
    const functions = {} as Functions

    const result = await issueDisplaySessionToken(functions, { lessonRunId: 'run-1' })

    expect(result).toEqual({ token: 'a'.repeat(64) })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'issueDisplaySessionTokenCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
  })
})

describe('exchangeDisplaySessionToken (client)', () => {
  it('calls exchangeDisplaySessionTokenCallable with lessonRunId+token and returns the custom token', async () => {
    callable.mockResolvedValue({ data: { customToken: 'custom-token-value' } })
    const functions = {} as Functions

    const result = await exchangeDisplaySessionToken(functions, { lessonRunId: 'run-1', token: 'plain-token' })

    expect(result).toEqual({ customToken: 'custom-token-value' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'exchangeDisplaySessionTokenCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', token: 'plain-token' })
  })
})

describe('signInForClassroomDisplay (client)', () => {
  it('exchanges the token then signs in with the resulting custom token, never touching any teacher credential', async () => {
    callable.mockResolvedValue({ data: { customToken: 'custom-token-value' } })
    signInWithCustomTokenMock.mockResolvedValue({ user: { uid: 'display-run-1' } })
    const functions = {} as Functions
    const auth = {} as Auth

    const result = await signInForClassroomDisplay(auth, functions, { lessonRunId: 'run-1', token: 'plain-token' })

    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', token: 'plain-token' })
    expect(signInWithCustomToken).toHaveBeenCalledWith(auth, 'custom-token-value')
    expect(result).toEqual({ user: { uid: 'display-run-1' } })
  })

  it('propagates exchange failures without attempting to sign in', async () => {
    callable.mockRejectedValue(new Error('token not found'))
    const functions = {} as Functions
    const auth = {} as Auth

    await expect(signInForClassroomDisplay(auth, functions, { lessonRunId: 'run-1', token: 'bad' })).rejects.toThrow('token not found')
    expect(signInWithCustomToken).not.toHaveBeenCalled()
  })
})
