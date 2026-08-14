import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  createTemplateShareCallable,
  duplicateLessonTemplateCallable,
  isValidDuplicateLessonTemplateInput,
  isValidPublishLessonVersionInput,
  publishLessonVersionCallable,
  resolveTemplateShareCallable,
  revokeTemplateShareCallable,
  type DuplicateLessonTemplateCallableInput,
  type PublishLessonVersionCallableInput,
} from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { publishLessonVersionWithAdminSdk } from './publishLessonVersion'
import { duplicateLessonTemplateWithAdminSdk } from './duplicateLessonTemplate'
import {
  createTemplateShareWithAdminSdk,
  resolveTemplateShareWithAdminSdk,
  revokeTemplateSharesWithAdminSdk,
} from './templateShares'

const templateGetMock = vi.fn()

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./publishLessonVersion', () => ({ publishLessonVersionWithAdminSdk: vi.fn() }))
vi.mock('./duplicateLessonTemplate', () => ({ duplicateLessonTemplateWithAdminSdk: vi.fn() }))
vi.mock('./templateShares', () => ({
  createTemplateShareWithAdminSdk: vi.fn(),
  resolveTemplateShareWithAdminSdk: vi.fn(),
  revokeTemplateSharesWithAdminSdk: vi.fn(),
}))
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

  it('rejects unauthenticated callers with unauthenticated', async () => {
    const request = { ...makeRequest(), auth: undefined } as unknown as CallableRequest<PublishLessonVersionCallableInput>
    await expect(publishLessonVersionCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects non-teacher callers with permission-denied without querying the template', async () => {
    const request = {
      ...makeRequest(),
      auth: { uid: 'student-1', token: { firebase: { sign_in_provider: 'anonymous' } } },
    } as unknown as CallableRequest<PublishLessonVersionCallableInput>

    await expect(publishLessonVersionCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(templateGetMock).not.toHaveBeenCalled()
  })

  it('rejects invalid payloads with invalid-argument', async () => {
    const request = { ...makeRequest(), data: {} } as unknown as CallableRequest<PublishLessonVersionCallableInput>
    await expect(publishLessonVersionCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects with not-found when the template does not exist, without ever publishing', async () => {
    templateGetMock.mockResolvedValue({ exists: false, get: () => undefined })

    await expect(publishLessonVersionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(publishLessonVersionWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds to publish once active membership is confirmed', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(publishLessonVersionWithAdminSdk).mockResolvedValue({ versionId: 'v-1', alreadyPublished: false })

    await expect(publishLessonVersionCallable.run(makeRequest())).resolves.toEqual({ versionId: 'v-1', alreadyPublished: false })

    expect(publishLessonVersionWithAdminSdk).toHaveBeenCalledWith({
      templateId: 'template-1',
      orgId: 'org-1',
      uid: 'teacher-a',
      changeSummary: undefined,
      idempotencyKey: 'key-1',
    })
  })

  it('translates a bare "Lesson template not found" Error from the pure layer into not-found', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(publishLessonVersionWithAdminSdk).mockRejectedValue(new Error('Lesson template not found'))

    await expect(publishLessonVersionCallable.run(makeRequest())).rejects.toMatchObject({
      code: 'not-found', message: 'Lesson template not found',
    })
  })

  it('translates a bare "Lesson template does not belong to the expected organization" Error from the pure layer into permission-denied', async () => {
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
      sourceTemplateId: 't1',
      sourceVersionId: 'v1',
      targetOrgId: 'org-target',
      confirmedOverrides: {},
      idempotencyKey: 'key-1',
    })).toBe(true)
  })

  it('rejects missing or malformed fields', () => {
    expect(isValidDuplicateLessonTemplateInput({})).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 't1' })).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 't1', sourceVersionId: 'v1', targetOrgId: 'org-1', confirmedOverrides: [], idempotencyKey: 'k' })).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 't1', sourceVersionId: 'v1', targetOrgId: 'org-1', confirmedOverrides: {}, idempotencyKey: 'k', shareToken: '' })).toBe(false)
    expect(isValidDuplicateLessonTemplateInput({ sourceTemplateId: 't1', sourceVersionId: 'v1', targetOrgId: 'org-1', confirmedOverrides: {}, idempotencyKey: 'k', shareToken: 123 })).toBe(false)
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

  it('skips the source-org membership check and duplicates when a valid matching shareToken is provided', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockResolvedValue({ templateId: 'source-template-1', versionId: 'version-1', sourceOrgId: 'org-source', createdByUid: 'teacher-other' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 }) // target org only
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockResolvedValue({ templateId: 'template-copy-1', alreadyDuplicated: false })

    const request = { ...makeRequest(), data: { ...makeRequest().data, shareToken: 'valid-token' } } as unknown as CallableRequest<DuplicateLessonTemplateCallableInput>
    await expect(duplicateLessonTemplateCallable.run(request)).resolves.toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledTimes(1)
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-target', 'teacher-target')
  })

  it('rejects with not-found when shareToken is invalid, expired, or revoked', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockRejectedValue(new Error('Template share not found'))
    const request = { ...makeRequest(), data: { ...makeRequest().data, shareToken: 'bad-token' } } as unknown as CallableRequest<DuplicateLessonTemplateCallableInput>
    await expect(duplicateLessonTemplateCallable.run(request)).rejects.toMatchObject({ code: 'not-found' })
    expect(duplicateLessonTemplateWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects with permission-denied when a valid shareToken targets a different template/version', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockResolvedValue({ templateId: 'other-template', versionId: 'other-version', sourceOrgId: 'org-source', createdByUid: 'teacher-other' })
    const request = { ...makeRequest(), data: { ...makeRequest().data, shareToken: 'valid-but-mismatched' } } as unknown as CallableRequest<DuplicateLessonTemplateCallableInput>
    await expect(duplicateLessonTemplateCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(duplicateLessonTemplateWithAdminSdk).not.toHaveBeenCalled()
  })
})

describe('createTemplateShareCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects expiresInDays outside 1-90 without reading the template', async () => {
    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 0 }))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 91 }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(templateGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not the template author', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'createdByUid' ? 'someone-else' : undefined) })
    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 30 }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(createTemplateShareWithAdminSdk).not.toHaveBeenCalled()
  })

  it('creates a share for the template author and returns the token', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    vi.mocked(createTemplateShareWithAdminSdk).mockResolvedValue({ token: 'plain-token' })

    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 30 }))).resolves.toEqual({ token: 'plain-token' })
    expect(createTemplateShareWithAdminSdk).toHaveBeenCalledWith({
      templateId: 't1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a', expiresInDays: 30,
    })
  })
})

describe('resolveTemplateShareCallable', () => {
  const auth = { uid: 'teacher-b', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects an invalid/expired/revoked token with not-found', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockRejectedValue(new Error('Template share not found'))
    await expect(resolveTemplateShareCallable.run(makeRequest({ token: 'bad' }))).rejects.toMatchObject({ code: 'not-found' })
  })

  it('returns the shared version content for a valid token', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockResolvedValue({ templateId: 't1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a' })
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'content' ? { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } : undefined) })

    await expect(resolveTemplateShareCallable.run(makeRequest({ token: 'good' }))).resolves.toEqual({
      templateId: 't1', versionId: 'v1', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' },
    })
  })
})

describe('revokeTemplateShareCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('always resolves, delegating creator-scoping to the query itself', async () => {
    vi.mocked(revokeTemplateSharesWithAdminSdk).mockResolvedValue(undefined)
    await expect(revokeTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1' }))).resolves.toEqual({ revoked: true })
    expect(revokeTemplateSharesWithAdminSdk).toHaveBeenCalledWith({ templateId: 't1', versionId: 'v1', createdByUid: 'teacher-a' })
  })
})
