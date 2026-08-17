import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { getLessonAnalyticsCallable } from './onCall'

const docGetMock = vi.fn()
const collectionQueryResults = new Map<string, unknown>()
const makeCollectionStub = (path: string) => ({
  get: () => {
    const raw = collectionQueryResults.get(path) as { docs?: unknown[]; empty?: boolean } | undefined
    const docs = (raw?.docs ?? []) as unknown[]
    const empty = raw?.empty ?? (docs.length === 0)
    return Promise.resolve({ empty, docs })
  },
  orderBy: () => makeCollectionStub(path),
  limit: () => makeCollectionStub(path),
})
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({ get: docGetMock }),
    collection: (path: string) => makeCollectionStub(path),
  }),
}))
vi.mock('../../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))

const makeRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
  data: () => fields,
})

const makeRequest = (uid = 'teacher-a'): CallableRequest =>
  ({ auth: { uid, token: {} }, data: { lessonRunId: 'run-1' }, rawRequest: {} } as unknown as CallableRequest)

describe('getLessonAnalyticsCallable', () => {
  beforeEach(() => {
    docGetMock.mockReset()
    collectionQueryResults.clear()
  })

  it('rejects a caller with no role on this lessonRun', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(getLessonAnalyticsCallable.run(makeRequest())).rejects.toThrow('この操作を行う権限がありません。')
  })

  it('grants a VIEWER role (read-only analytics) and returns computed analytics with resolved display names/team names', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, {
      orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' }, templateSnapshot: { title: '株式投資シミュレーション' },
    }))
    collectionQueryResults.set('lessonRuns/run-1/participants', {
      docs: [
        { data: () => ({ id: 'p-1', displayName: '山田太郎', teamId: 'team-a' }) },
        { data: () => ({ id: 'p-2', displayName: '鈴木花子', teamId: 'team-a' }) },
      ],
    })
    collectionQueryResults.set('lessonRuns/run-1/teams', {
      docs: [{ id: 'team-a', data: () => ({ displayName: 'Aチーム' }) }],
    })
    collectionQueryResults.set('lessonRuns/run-1/events', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/responses', {
      docs: [{ data: () => ({ id: 'r-1', participantId: 'p-1', teamId: 'team-a', status: 'CONFIRMED', rationaleInformationIds: ['info-1'] }) }],
    })
    collectionQueryResults.set('lessonRuns/run-1/results', { docs: [] })

    const response = await getLessonAnalyticsCallable.run(makeRequest())
    expect(response).toEqual(expect.objectContaining({
      lessonRunId: 'run-1',
      lessonTitle: '株式投資シミュレーション',
      totalParticipantCount: 2,
      teams: [{ teamId: 'team-a', teamName: 'Aチーム' }],
    }))
    const data = response as { individualRows: Array<{ participantId: string; displayName: string }> }
    expect(data.individualRows).toEqual([
      expect.objectContaining({ participantId: 'p-1', displayName: '山田太郎' }),
    ])
  })

  it('reads surveyResponses from the most recently generated result, when one exists', async () => {
    docGetMock.mockResolvedValue(makeRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    collectionQueryResults.set('lessonRuns/run-1/participants', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/teams', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/events', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/responses', { docs: [] })
    collectionQueryResults.set('lessonRuns/run-1/results', { docs: [{ id: 'result-1', data: () => ({ id: 'result-1' }) }] })
    collectionQueryResults.set('lessonRuns/run-1/results/result-1/surveyResponses', {
      docs: [{ data: () => ({ id: 'sr-1', participantId: 'p-1', answers: { COMPREHENSION: 4 } }) }],
    })

    const response = await getLessonAnalyticsCallable.run(makeRequest())
    const data = response as { aggregate: { comprehensionAverage: number | null } }
    expect(data.aggregate.comprehensionAverage).toBe(4)
  })
})
