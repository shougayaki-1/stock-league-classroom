import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  duplicateLessonTemplateCallable,
  isValidDuplicateLessonTemplateInput,
  isValidPublishLessonVersionInput,
  publishLessonVersionCallable,
  type DuplicateLessonTemplateCallableInput,
  type PublishLessonVersionCallableInput,
} from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { publishLessonVersionWithAdminSdk } from './publishLessonVersion'
import { duplicateLessonTemplateWithAdminSdk } from './duplicateLessonTemplate'

const templateGetMock = vi.fn()

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./publishLessonVersion', () => ({ publishLessonVersionWithAdminSdk: vi.fn() }))
vi.mock('./duplicateLessonTemplate', () => ({ duplicateLessonTemplateWithAdminSdk: vi.fn() }))
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

describe('isValidDuplicateLessonTemplateInput', () => {
  it('accepts a well-formed request payload', () => {
    expect(isValidDuplicateLessonTemplateInput({
      sourceTemplateId: 't1', sourceVersionId: 'v1', targetOrgId: 'org-target', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })).toBe(true)
  })

  it('rejects missing or malformed fields', () => {
    expect(isValidDuplicateLessonTemplateInput({})).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 't1', sourceVersionId: 'v1', targetOrgId: 'org-target', idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 1, sourceVersionId: 'v1', targetOrgId: 'org-target', confirmedOverrides: {}, idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 't1', sourceVersionId: 'v1', targetOrgId: 'org-target', confirmedOverrides: 'x', idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 't1', sourceVersionId: 'v1', targetOrgId: 'org-target', confirmedOverrides: {}, idempotencyKey: '' })).toBe(false)
    expect(isValidDuplicateLessonTemplateInput(null)).toBe(false)
  })
})

describe('duplicateLessonTemplateCallable', () => {
  const makeRequest = (): CallableRequest<DuplicateLessonTemplateCallableInput> => ({
    auth: {
      uid: 'teacher-target',
      token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
    },
    data: { sourceTemplateId: 'source-template-1', sourceVersionId: 'version-1', targetOrgId: 'org-target', confirmedOverrides: {}, idempotencyKey: 'key-1' },
    rawRequest: {},
  } as unknown as CallableRequest<DuplicateLessonTemplateCallableInput>)

  beforeEach(() => {
    vi.clearAllMocks()
    // The source template exists and belongs to org-source — resolved server-side, never from client input.
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'org-source' : undefined),
    })
  })

  it('rejects with not-found when the source template does not exist, without ever duplicating', async () => {
    templateGetMock.mockResolvedValue({ exists: false, get: () => undefined })

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(duplicateLessonTemplateWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects with permission-denied when the caller has no active membership in the source org, without ever duplicating', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValue(new HttpsError('permission-denied', '有効な組織メンバーではありません。'))

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-source', 'teacher-target')
    expect(duplicateLessonTemplateWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects with permission-denied when the caller has no active membership in the target org, without ever duplicating', async () => {
    vi.mocked(requireActiveOrgMember)
      .mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 }) // source org: ok
      .mockRejectedValueOnce(new HttpsError('permission-denied', '有効な組織メンバーではありません。')) // target org: denied

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).toHaveBeenNthCalledWith(2, expect.anything(), 'org-target', 'teacher-target')
    expect(duplicateLessonTemplateWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds to duplicate once active membership in both source and target orgs is confirmed', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockResolvedValue({ templateId: 'template-copy-1', alreadyDuplicated: false })

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).resolves.toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })

    expect(duplicateLessonTemplateWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      targetOrgId: 'org-target',
      uid: 'teacher-target',
      confirmedOverrides: {},
      idempotencyKey: 'key-1',
    }))
  })

  it('translates a bare "Source lesson version not found" Error from the pure layer into not-found', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockRejectedValue(new Error('Source lesson version not found'))

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).rejects.toMatchObject({
      code: 'not-found', message: 'Source lesson version not found',
    })
  })

  it('translates a bare version/template mismatch Error from the pure layer into permission-denied', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockRejectedValue(new Error('Source lesson version does not belong to the expected template'))

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).rejects.toMatchObject({
      code: 'permission-denied', message: 'Source lesson version does not belong to the expected template',
    })
  })

  it('translates a bare "Idempotency key payload mismatch" Error from the pure layer into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).rejects.toMatchObject({
      code: 'failed-precondition', message: 'Idempotency key payload mismatch',
    })
  })
})
