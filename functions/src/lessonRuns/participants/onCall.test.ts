import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { joinLessonRunCallable } from './onCall'
import { joinLessonRunWithAdminSdk } from '../joinLessonRun'

vi.mock('../joinLessonRun', () => ({ joinLessonRunWithAdminSdk: vi.fn() }))

interface JoinLessonRunRequest {
  joinCode: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  idempotencyKey: string
}

const makeRequest = (data: Partial<JoinLessonRunRequest> = {}, uid = 'student-a'): CallableRequest<JoinLessonRunRequest> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'anonymous' } } },
  data: {
    joinCode: 'ABCDEF', identityMode: 'QUICK_JOIN', displayName: 'たろう', idempotencyKey: 'join-1', ...data,
  },
  rawRequest: {},
} as unknown as CallableRequest<JoinLessonRunRequest>)

describe('joinLessonRunCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers without calling joinLessonRun', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<JoinLessonRunRequest>
    await expect(joinLessonRunCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(joinLessonRunWithAdminSdk).not.toHaveBeenCalled()
  })

  it.each([
    ['joinCode', { joinCode: '' }],
    ['identityMode', { identityMode: '' as never }],
    ['displayName', { displayName: '  ' }],
    ['idempotencyKey', { idempotencyKey: '' }],
  ])('rejects a request missing %s, never calling joinLessonRun', async (_field, override) => {
    await expect(joinLessonRunCallable.run(makeRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(joinLessonRunWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an invalid identityMode value', async () => {
    await expect(joinLessonRunCallable.run(makeRequest({ identityMode: 'HACKED' as never })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
    expect(joinLessonRunWithAdminSdk).not.toHaveBeenCalled()
  })

  it('resolves authUid from the verified token, never from client data', async () => {
    vi.mocked(joinLessonRunWithAdminSdk).mockResolvedValue({
      lessonRunId: 'run-1', participantId: 'p-1', duplicateIdentifierWarning: false, deduplicated: false,
    })
    const request = makeRequest({}, 'student-a')
    ;(request.data as unknown as Record<string, unknown>).authUid = 'attacker-supplied-uid'

    await joinLessonRunCallable.run(request)

    expect(joinLessonRunWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({ authUid: 'student-a' }))
  })

  it('forwards a successful join result unchanged', async () => {
    vi.mocked(joinLessonRunWithAdminSdk).mockResolvedValue({
      lessonRunId: 'run-1', participantId: 'p-1', teamId: 'team-1', duplicateIdentifierWarning: true, deduplicated: false,
    })
    await expect(joinLessonRunCallable.run(makeRequest())).resolves.toEqual({
      lessonRunId: 'run-1', participantId: 'p-1', teamId: 'team-1', duplicateIdentifierWarning: true, deduplicated: false,
    })
  })

  it.each([
    ['Join code not found', 'not-found'],
    ['Join code is not active', 'failed-precondition'],
    ['LessonRun not found', 'not-found'],
    ['LessonRun is not accepting participants', 'failed-precondition'],
    ['LessonRun has reached its maximum number of participants', 'resource-exhausted'],
    ['Participant has been suspended from this lesson', 'permission-denied'],
    ['Idempotency key payload mismatch', 'failed-precondition'],
  ] as const)('translates a bare "%s" Error from joinLessonRun into %s', async (message, code) => {
    vi.mocked(joinLessonRunWithAdminSdk).mockRejectedValue(new Error(message))
    await expect(joinLessonRunCallable.run(makeRequest())).rejects.toMatchObject({ code, message })
  })
})
