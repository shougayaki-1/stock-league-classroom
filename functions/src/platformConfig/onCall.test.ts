import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { getTuningConstantsCallable } from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }))
vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))

const request = (auth: CallableRequest['auth']): CallableRequest => ({ auth, data: undefined, rawRequest: {} } as unknown as CallableRequest)
const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']

describe('getTuningConstantsCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects unauthenticated and non-teacher callers', async () => {
    await expect(getTuningConstantsCallable.run(request(undefined))).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(getTuningConstantsCallable.run(request({ uid: 'student', token: { email_verified: true, firebase: { sign_in_provider: 'anonymous' } } } as unknown as CallableRequest['auth']))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('requires the caller to be active in the caller-owned personal organization', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    await expect(getTuningConstantsCallable.run(request(teacher))).rejects.toThrow('permission-denied')

    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(getTuningConstantsCallable.run(request(teacher))).resolves.toMatchObject({ homeEconomics: { taxModelV1RatePercent: expect.any(Number) } })
    expect(requireActiveOrgMember).toHaveBeenLastCalledWith(expect.anything(), 'personal_teacher-1', 'teacher-1')
  })
})
