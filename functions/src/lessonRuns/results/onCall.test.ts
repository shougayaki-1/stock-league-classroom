import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { generateLessonResultCallable, getMyLessonResultCallable } from './onCall'
import * as buildResults from './buildResults'

const docGetMock = vi.fn()
const collectionGetMock = vi.fn()
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({ get: docGetMock }),
    collection: () => ({ orderBy: () => ({ limit: () => ({ get: collectionGetMock }) }) }),
  }),
}))
vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./buildResults', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./buildResults')>()
  return { ...actual, buildAndPersistLessonResultWithAdminSdk: vi.fn() }
})

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

describe('generateLessonResultCallable', () => {
  beforeEach(() => {
    docGetMock.mockReset()
    vi.mocked(buildResults.buildAndPersistLessonResultWithAdminSdk).mockReset()
  })

  const makeRequest = (data: Record<string, unknown> = {}, uid = 'teacher-a'): CallableRequest =>
    ({ auth: { uid, token: {} }, data: { lessonRunId: 'run-1', phaseId: 'phase-1', idempotencyKey: 'idem-1', ...data }, rawRequest: {} } as unknown as CallableRequest)

  it('rejects a caller with no role on this lessonRun', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(generateLessonResultCallable.run(makeRequest())).rejects.toThrow('この操作を行う権限がありません。')
  })

  it('rejects a VIEWER role (not authorized to generate results)', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(generateLessonResultCallable.run(makeRequest())).rejects.toThrow('この操作を行う権限がありません。')
  })

  it('calls buildAndPersistLessonResultWithAdminSdk for an authorized PRIMARY teacher', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(buildResults.buildAndPersistLessonResultWithAdminSdk).mockResolvedValue({
      resultId: 'result-1', result: { id: 'result-1', lessonRunId: 'run-1', orgId: 'org-1', phaseId: 'phase-1', generatedAt: 'now', responses: [] }, deduplicated: false,
    })
    const response = await generateLessonResultCallable.run(makeRequest())
    expect(response).toEqual(expect.objectContaining({ resultId: 'result-1', deduplicated: false }))
    expect(buildResults.buildAndPersistLessonResultWithAdminSdk).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', orgId: 'org-1', phaseId: 'phase-1', idempotencyKey: 'idem-1', actorId: 'teacher-a',
    }))
  })
})

describe('getMyLessonResultCallable', () => {
  beforeEach(() => {
    docGetMock.mockReset()
    collectionGetMock.mockReset()
  })

  const makeRequest = (uid = 'student-uid'): CallableRequest =>
    ({ auth: { uid, token: {} }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as unknown as CallableRequest)

  it('rejects an unauthenticated caller', async () => {
    await expect(getMyLessonResultCallable.run({ auth: undefined, data: { lessonRunId: 'run-1' }, rawRequest: {} } as unknown as CallableRequest))
      .rejects.toThrow('サインインが必要です。')
  })

  it('rejects a caller with no participant index entry on this lessonRun', async () => {
    docGetMock.mockResolvedValueOnce({ exists: false })
    await expect(getMyLessonResultCallable.run(makeRequest())).rejects.toThrow('このレッスンランに参加していません。')
  })

  it('returns found: false when no result has been generated yet', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ participantId: 'p-1' }) }) // participantsByAuthUid index
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ teamId: 'team-a' }) }) // participants/{id}
    collectionGetMock.mockResolvedValueOnce({ empty: true, docs: [] })
    const response = await getMyLessonResultCallable.run(makeRequest())
    expect(response).toEqual({ found: false, lessonRunId: 'run-1', items: [] })
  })

  it('returns only the responses matching the caller\'s own participantId or teamId', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ participantId: 'p-1' }) })
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({ teamId: 'team-a' }) })
    collectionGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [{
        data: () => ({
          id: 'result-1', lessonRunId: 'run-1', orgId: 'org-1', phaseId: 'phase-1', generatedAt: '2026-01-01T00:00:00.000Z',
          externalTaskUrl: 'https://example.com/task',
          responses: [
            { responseId: 'r-1', scope: 'participant', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: '選択肢A', confirmedAt: null, decisionExplanation: { whatHappened: 'a', whyItHappened: 'b', alternative: 'c', nextAction: 'd' } },
            { responseId: 'r-2', scope: 'team', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-2', value: 42, confirmedAt: null, decisionExplanation: { whatHappened: 'e', whyItHappened: 'f', alternative: 'g', nextAction: 'h' } },
            { responseId: 'r-3', scope: 'participant', participantId: 'p-2', phaseId: 'phase-1', inputId: 'input-3', value: '他人の回答', confirmedAt: null, decisionExplanation: { whatHappened: '', whyItHappened: '', alternative: '', nextAction: '' } },
          ],
        }),
      }],
    })
    const response = await getMyLessonResultCallable.run(makeRequest())
    expect(response).toEqual({
      found: true,
      lessonRunId: 'run-1',
      externalTaskUrl: 'https://example.com/task',
      items: [
        { responseId: 'r-1', scope: 'participant', displayValue: '選択肢A', decisionExplanation: { whatHappened: 'a', whyItHappened: 'b', alternative: 'c', nextAction: 'd' } },
        { responseId: 'r-2', scope: 'team', displayValue: '42', decisionExplanation: { whatHappened: 'e', whyItHappened: 'f', alternative: 'g', nextAction: 'h' } },
      ],
    })
  })
})
