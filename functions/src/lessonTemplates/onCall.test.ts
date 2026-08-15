import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  canReviewTemplateCallable,
  createTemplateShareCallable,
  duplicateLessonTemplateCallable,
  grantOperatorCallable,
  isValidDuplicateLessonTemplateInput,
  isValidPublishLessonVersionInput,
  listPendingTemplateReportsCallable,
  listTemplateReviewsCallable,
  publishLessonVersionCallable,
  publishTemplateToCommunityCallable,
  reportTemplateCallable,
  resolveTemplateReportCallable,
  resolveTemplateShareCallable,
  revokeTemplateShareCallable,
  submitTemplateReviewCallable,
  unpublishTemplateFromCommunityCallable,
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
import {
  isEligibleToReviewTemplate,
  listTemplateReviews,
  submitTemplateReview,
} from './templateReviews'

const templateGetMock = vi.fn()
const templateUpdateMock = vi.fn()
const reportAddMock = vi.fn()
const reportGetMock = vi.fn()
const reportUpdateMock = vi.fn()
const reportsWhereGetMock = vi.fn()
const setCustomUserClaimsMock = vi.fn()

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./publishLessonVersion', () => ({ publishLessonVersionWithAdminSdk: vi.fn() }))
vi.mock('./duplicateLessonTemplate', () => ({ duplicateLessonTemplateWithAdminSdk: vi.fn() }))
vi.mock('./templateShares', () => ({
  createTemplateShareWithAdminSdk: vi.fn(),
  resolveTemplateShareWithAdminSdk: vi.fn(),
  revokeTemplateSharesWithAdminSdk: vi.fn(),
}))
vi.mock('./templateReviews', () => ({
  getTemplateReviewDepsWithAdminSdk: vi.fn(() => ({})),
  isEligibleToReviewTemplate: vi.fn(),
  submitTemplateReview: vi.fn(),
  listTemplateReviews: vi.fn(),
}))
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  getFirestore: () => ({
    doc: (path: string) => path.startsWith('templateReports/')
      ? { get: reportGetMock, update: reportUpdateMock }
      : { get: templateGetMock, update: templateUpdateMock },
    collection: (path: string) => path === 'templateReports'
      ? { add: reportAddMock, where: () => ({ get: reportsWhereGetMock }) }
      : undefined,
  }),
}))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ setCustomUserClaims: setCustomUserClaimsMock }) }))

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

  it('skips source-org membership and duplicates when the source template is COMMUNITY-visible', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'visibility' ? 'COMMUNITY' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 }) // target org only
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockResolvedValue({ templateId: 'template-copy-1', alreadyDuplicated: false })

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).resolves.toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledTimes(1)
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-target', 'teacher-target')
  })

  it('still requires source-org membership when the source template is PRIVATE and no shareToken is given', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'visibility' ? 'PRIVATE' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockResolvedValue({ templateId: 'template-copy-1', alreadyDuplicated: false })

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).resolves.toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledTimes(2)
    expect(requireActiveOrgMember).toHaveBeenNthCalledWith(1, expect.anything(), 'org-source', 'teacher-target')
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

describe('publishTemplateToCommunityCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks(); templateUpdateMock.mockResolvedValue(undefined) })

  it('rejects a caller who is not the template author', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'createdByUid' ? 'someone-else' : field === 'currentPublishedVersionId' ? 'v1' : undefined),
    })
    await expect(publishTemplateToCommunityCallable.run(makeRequest({ templateId: 't1' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(templateUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects a template with no published version', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'createdByUid' ? 'teacher-a' : field === 'currentPublishedVersionId' ? null : undefined),
    })
    await expect(publishTemplateToCommunityCallable.run(makeRequest({ templateId: 't1' }))).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(templateUpdateMock).not.toHaveBeenCalled()
  })

  it('publishes for the template author when a published version exists', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'createdByUid' ? 'teacher-a' : field === 'currentPublishedVersionId' ? 'v1' : undefined),
    })
    await expect(publishTemplateToCommunityCallable.run(makeRequest({ templateId: 't1' }))).resolves.toEqual({ published: true })
    expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'COMMUNITY', publishedToCommunityAt: 'SERVER_TIMESTAMP' })
  })
})

describe('unpublishTemplateFromCommunityCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks(); templateUpdateMock.mockResolvedValue(undefined) })

  it('rejects a caller who is not the template author', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'createdByUid' ? 'someone-else' : undefined) })
    await expect(unpublishTemplateFromCommunityCallable.run(makeRequest({ templateId: 't1' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(templateUpdateMock).not.toHaveBeenCalled()
  })

  it('unpublishes for the template author', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'createdByUid' ? 'teacher-a' : undefined) })
    await expect(unpublishTemplateFromCommunityCallable.run(makeRequest({ templateId: 't1' }))).resolves.toEqual({ published: false })
    expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'PRIVATE' })
  })
})

describe('reportTemplateCallable', () => {
  const auth = { uid: 'teacher-b', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects an invalid reason without reading the template', async () => {
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'NOT_A_REAL_REASON' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(templateGetMock).not.toHaveBeenCalled()
  })

  it('rejects a report on a template that does not exist', async () => {
    templateGetMock.mockResolvedValue({ exists: false })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))).rejects.toMatchObject({ code: 'not-found' })
    expect(reportAddMock).not.toHaveBeenCalled()
  })

  it('rejects a report on a template that is not COMMUNITY-visible', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'PRIVATE' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))).rejects.toMatchObject({ code: 'not-found' })
    expect(reportAddMock).not.toHaveBeenCalled()
  })

  it('rejects a caller reporting their own template', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'COMMUNITY' : field === 'createdByUid' ? 'teacher-b' : undefined) })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(reportAddMock).not.toHaveBeenCalled()
  })

  it('creates a PENDING report for a valid COMMUNITY template reported by someone else', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'COMMUNITY' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    reportAddMock.mockResolvedValue({ id: 'report-1' })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'COPYRIGHT', details: '出典不明' }))).resolves.toEqual({ reportId: 'report-1' })
    expect(reportAddMock).toHaveBeenCalledWith({
      templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT', details: '出典不明',
      status: 'PENDING', resolution: null, resolvedByUid: null, resolvedAt: null, createdAt: 'SERVER_TIMESTAMP',
    })
  })

  it('defaults details to null when omitted', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'COMMUNITY' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    reportAddMock.mockResolvedValue({ id: 'report-1' })
    await reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))
    expect(reportAddMock).toHaveBeenCalledWith(expect.objectContaining({ details: null }))
  })
})

describe('listPendingTemplateReportsCallable', () => {
  const teacherAuth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const operatorAuth = { uid: 'operator-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' }, operator: true } }
  const makeRequest = (auth: typeof teacherAuth) => ({ auth, data: {}, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a non-operator caller', async () => {
    await expect(listPendingTemplateReportsCallable.run(makeRequest(teacherAuth))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(reportsWhereGetMock).not.toHaveBeenCalled()
  })

  it('returns PENDING reports enriched with the reported template title', async () => {
    reportsWhereGetMock.mockResolvedValue({
      docs: [{ id: 'report-1', data: () => ({ templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT', details: null, status: 'PENDING', createdAt: 'sometime' }) }],
    })
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'title' ? '通報された教材' : undefined) })

    await expect(listPendingTemplateReportsCallable.run(makeRequest(operatorAuth))).resolves.toEqual([
      { id: 'report-1', templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT', details: null, createdAt: 'sometime', templateTitle: '通報された教材' },
    ])
  })
})

describe('resolveTemplateReportCallable', () => {
  const teacherAuth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const operatorAuth = { uid: 'operator-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' }, operator: true } }
  const makeRequest = (auth: typeof teacherAuth, data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a non-operator caller', async () => {
    await expect(resolveTemplateReportCallable.run(makeRequest(teacherAuth, { reportId: 'report-1', action: 'DISMISS' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(reportGetMock).not.toHaveBeenCalled()
  })

  it('rejects a report that does not exist or is already resolved', async () => {
    reportGetMock.mockResolvedValue({ exists: false })
    await expect(resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'missing', action: 'DISMISS' }))).rejects.toMatchObject({ code: 'not-found' })

    reportGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'status' ? 'RESOLVED' : undefined) })
    await expect(resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'report-1', action: 'DISMISS' }))).rejects.toMatchObject({ code: 'not-found' })
  })

  it('DISMISS resolves the report without touching the template', async () => {
    reportGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'status' ? 'PENDING' : field === 'templateId' ? 't1' : undefined) })
    await resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'report-1', action: 'DISMISS' }))
    expect(templateUpdateMock).not.toHaveBeenCalled()
    expect(reportUpdateMock).toHaveBeenCalledWith({ status: 'RESOLVED', resolution: 'DISMISSED', resolvedByUid: 'operator-a', resolvedAt: 'SERVER_TIMESTAMP' })
  })

  it('UNPUBLISH sets the template back to PRIVATE and resolves the report', async () => {
    reportGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'status' ? 'PENDING' : field === 'templateId' ? 't1' : undefined) })
    await resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'report-1', action: 'UNPUBLISH' }))
    expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'PRIVATE' })
    expect(reportUpdateMock).toHaveBeenCalledWith({ status: 'RESOLVED', resolution: 'UNPUBLISHED', resolvedByUid: 'operator-a', resolvedAt: 'SERVER_TIMESTAMP' })
  })
})

describe('grantOperatorCallable', () => {
  const teacherAuth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const operatorAuth = { uid: 'operator-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' }, operator: true } }
  const makeRequest = (auth: typeof teacherAuth, data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a non-operator caller', async () => {
    await expect(grantOperatorCallable.run(makeRequest(teacherAuth, { targetUid: 'teacher-b' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled()
  })

  it('grants the operator claim to the target user', async () => {
    setCustomUserClaimsMock.mockResolvedValue(undefined)
    await expect(grantOperatorCallable.run(makeRequest(operatorAuth, { targetUid: 'teacher-b' }))).resolves.toEqual({ granted: true })
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith('teacher-b', { operator: true })
  })
})

describe('canReviewTemplateCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('returns the eligibility check result', async () => {
    vi.mocked(isEligibleToReviewTemplate).mockResolvedValue(true)
    await expect(canReviewTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1' }))).resolves.toEqual({ eligible: true })
    expect(isEligibleToReviewTemplate).toHaveBeenCalledWith(expect.anything(), { templateId: 't1', versionId: 'v1', uid: 'teacher-a' })
  })
})

describe('submitTemplateReviewCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects ratings outside 1-5', async () => {
    await expect(submitTemplateReviewCallable.run(makeRequest({
      templateId: 't1', versionId: 'v1', clarityRating: 0, easeOfImplementationRating: 3, studentResponseRating: 3,
    }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(submitTemplateReview).not.toHaveBeenCalled()
  })

  it('translates the pure layer\'s not-eligible error into permission-denied', async () => {
    vi.mocked(submitTemplateReview).mockRejectedValue(new Error('Not eligible to review this template version'))
    await expect(submitTemplateReviewCallable.run(makeRequest({
      templateId: 't1', versionId: 'v1', clarityRating: 3, easeOfImplementationRating: 3, studentResponseRating: 3,
    }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('submits a valid review, defaulting comment to null', async () => {
    vi.mocked(submitTemplateReview).mockResolvedValue(undefined)
    await expect(submitTemplateReviewCallable.run(makeRequest({
      templateId: 't1', versionId: 'v1', clarityRating: 5, easeOfImplementationRating: 4, studentResponseRating: 3,
    }))).resolves.toEqual({ submitted: true })
    expect(submitTemplateReview).toHaveBeenCalledWith(expect.anything(), {
      templateId: 't1', versionId: 'v1', uid: 'teacher-a',
      clarityRating: 5, easeOfImplementationRating: 4, studentResponseRating: 3, comment: null,
    })
  })
})

describe('listTemplateReviewsCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('returns the review list', async () => {
    vi.mocked(listTemplateReviews).mockResolvedValue([{ comment: 'よかった' }])
    await expect(listTemplateReviewsCallable.run(makeRequest({ templateId: 't1', versionId: 'v1' }))).resolves.toEqual([{ comment: 'よかった' }])
  })
})




