import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { isValidPublishLessonVersionInput, publishLessonVersionCallable, type PublishLessonVersionCallableInput } from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { publishLessonVersionWithAdminSdk } from './publishLessonVersion'

const templateGetMock = vi.fn()

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./publishLessonVersion', () => ({ publishLessonVersionWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: templateGetMock }) }),
}))

describe('isValidPublishLessonVersionInput', () => {
  it('accepts a well-formed request payload', () => {
    expect(isValidPublishLessonVersionInput({ templateId: 't1', idempotencyKey: 'key-1' })).toBe(true)
    expect(isValidPublishLessonVersionInput({ templateId: 't1', changeSummary: '要約', idempotencyKey: 'key-1' })).toBe(true)
  })

  it('rejects missing or malformed fields', () => {
    expect(isValidPublishLessonVersionInput({})).toBe(false)
    expect(isValidPublishLessonVersionInput({ templateId: 't1' })).toBe(false)
    expect(isValidPublishLessonVersionInput({ idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidPublishLessonVersionInput({ templateId: 1, idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidPublishLessonVersionInput({ templateId: 't1', changeSummary: 5, idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidPublishLessonVersionInput(null)).toBe(false)
  })
})

describe('publishLessonVersionCallable', () => {
  const makeRequest = (): CallableRequest<PublishLessonVersionCallableInput> => ({
    auth: {
      uid: 'teacher-a',
      token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
    },
    data: { templateId: 'template-1', idempotencyKey: 'key-1' },
    rawRequest: {},
  } as unknown as CallableRequest<PublishLessonVersionCallableInput>)

  beforeEach(() => {
    vi.clearAllMocks()
    // The template exists and belongs to org-1 — resolved server-side, never from client input.
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'org-1' : undefined),
    })
  })

  it('rejects with permission-denied when the caller has no active org membership, without ever publishing', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))

    await expect(publishLessonVersionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-1', 'teacher-a')
    expect(publishLessonVersionWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects with permission-denied when the membership doc exists but is not active, without ever publishing', async () => {
    // requireActiveOrgMember itself throws in this case; asserted here to document the
    // Callable's behavior at its call boundary regardless of *why* the guard rejected.
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))

    await expect(publishLessonVersionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(publishLessonVersionWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds to publish once an active membership is confirmed', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(publishLessonVersionWithAdminSdk).mockResolvedValue({ versionId: 'v1', alreadyPublished: false })

    await expect(publishLessonVersionCallable.run(makeRequest())).resolves.toEqual({ versionId: 'v1', alreadyPublished: false })

    expect(publishLessonVersionWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'template-1',
      orgId: 'org-1',
      uid: 'teacher-a',
      idempotencyKey: 'key-1',
    }))
  })

  it('translates a bare "Lesson template not found" Error from the pure layer into not-found', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(publishLessonVersionWithAdminSdk).mockRejectedValue(new Error('Lesson template not found'))

    await expect(publishLessonVersionCallable.run(makeRequest())).rejects.toMatchObject({
      code: 'not-found', message: 'Lesson template not found',
    })
  })

  it('translates a bare org-mismatch Error from the pure layer into permission-denied', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(publishLessonVersionWithAdminSdk).mockRejectedValue(new Error('Lesson template does not belong to the expected organization'))

    await expect(publishLessonVersionCallable.run(makeRequest())).rejects.toMatchObject({
      code: 'permission-denied', message: 'Lesson template does not belong to the expected organization',
    })
  })

  it('translates a bare "Idempotency key payload mismatch" Error from the pure layer into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(publishLessonVersionWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))

    await expect(publishLessonVersionCallable.run(makeRequest())).rejects.toMatchObject({
      code: 'failed-precondition', message: 'Idempotency key payload mismatch',
    })
  })
})
