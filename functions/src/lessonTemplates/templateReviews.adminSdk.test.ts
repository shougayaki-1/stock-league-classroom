import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const queryResults = new Map<string, DocumentData[]>()

const doc = (path: string) => ({
  get: async () => (documents.has(path) ? { exists: true, data: () => documents.get(path) } : { exists: false, data: () => undefined }),
  set: async (data: DocumentData) => { documents.set(path, data) },
  update: async (data: DocumentData) => { documents.set(path, { ...(documents.get(path) ?? {}), ...data }) },
})

const collection = (path: string) => ({
  where: () => ({
    where: () => ({
      where: () => ({ get: async () => ({ docs: (queryResults.get(path) ?? []).map((data, index) => ({ id: `${path}-${index}`, data: () => data })) }) }),
      get: async () => ({ docs: (queryResults.get(path) ?? []).map((data, index) => ({ id: `${path}-${index}`, data: () => data })) }),
    }),
    get: async () => ({ docs: (queryResults.get(path) ?? []).map((data, index) => ({ id: `${path}-${index}`, data: () => data })) }),
  }),
})

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc, collection }) }))

import { getTemplateReviewDepsWithAdminSdk } from './templateReviews'

describe('getTemplateReviewDepsWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); queryResults.clear() })

  it('getCompletedRunTemplateVersionIds queries lessonRuns by templateId/uid/COMPLETED and returns templateVersionIds', async () => {
    queryResults.set('lessonRuns', [{ templateVersionId: 'v1' }, { templateVersionId: 'v2' }])
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.getCompletedRunTemplateVersionIds('t1', 'teacher-a')).resolves.toEqual(['v1', 'v2'])
  })

  it('getOwnDuplicateTemplateIds queries lessonTemplates by sourceTemplateId/sourceVersionId/createdByUid and returns doc ids', async () => {
    queryResults.set('lessonTemplates', [{}, {}])
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.getOwnDuplicateTemplateIds('t1', 'v1', 'teacher-b')).resolves.toEqual(['lessonTemplates-0', 'lessonTemplates-1'])
  })

  it('getReview/setReview round-trip through templateReviews/{versionId}_{uid}', async () => {
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.getReview('v1', 'teacher-a')).resolves.toEqual({ exists: false, data: undefined })
    await deps.setReview('v1', 'teacher-a', { comment: 'よかった' })
    const result = await deps.getReview('v1', 'teacher-a')
    expect(result.exists).toBe(true)
    expect(result.data).toEqual({ comment: 'よかった' })
  })

  it('listReviewsForVersion queries templateReviews by versionId', async () => {
    queryResults.set('templateReviews', [{ comment: 'よい教材' }])
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.listReviewsForVersion('v1')).resolves.toEqual([{ comment: 'よい教材' }])
  })

  it('updateTemplateAggregate updates lessonTemplates/{templateId}', async () => {
    const deps = getTemplateReviewDepsWithAdminSdk()
    await deps.updateTemplateAggregate('t1', { reviewCount: 3 })
    const snap = await doc('lessonTemplates/t1').get()
    expect(snap.data()).toEqual({ reviewCount: 3 })
  })
})
