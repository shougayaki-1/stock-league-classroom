import { describe, expect, it } from 'vitest'
import { publishLessonVersion } from './publishLessonVersion'

interface FakeDoc { path: string; data: Record<string, unknown> }

const makeFakeFirestore = (seed: FakeDoc[] = []) => {
  const docs = new Map<string, Record<string, unknown>>()
  for (const { path, data } of seed) docs.set(path, data)
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
      set: (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => void
    }) => Promise<unknown>) => fn({
      get: async (path: string) => (docs.has(path) ? { exists: true, data: docs.get(path) } : { exists: false }),
      set: (path: string, data: Record<string, unknown>, options) => {
        docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : data)
      },
    }),
  }
}

const makeDeps = (fake: ReturnType<typeof makeFakeFirestore>, uuids: string[] = ['version-1']) => {
  let call = 0
  return {
    firestore: fake as never,
    randomUUID: () => uuids[call++] ?? `version-${call}`,
  }
}

const baseTemplate = {
  orgId: 'personal_teacher-a',
  createdByUid: 'teacher-a',
  draft: { schemaVersion: 1, title: 'ドラフト', description: '', subject: 'SOCIAL_STUDIES' },
  currentPublishedVersionId: null,
  status: 'DRAFT',
  visibility: 'PRIVATE',
}

describe('publishLessonVersion', () => {
  it('creates a version doc from the current draft and updates the template pointer/status in one transaction', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/t1', data: baseTemplate }])
    const result = await publishLessonVersion(makeDeps(fake), {
      templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '初版', idempotencyKey: 'key-1',
    })

    expect(result.versionId).toBe('version-1')
    expect(result.alreadyPublished).toBe(false)
    expect(fake.docs.get('lessonTemplates/t1/versions/version-1')).toMatchObject({
      templateId: 't1', orgId: 'personal_teacher-a', schemaVersion: 1,
      content: baseTemplate.draft, createdByUid: 'teacher-a', changeSummary: '初版', immutable: true,
    })
    expect(fake.docs.get('lessonTemplates/t1')).toMatchObject({ currentPublishedVersionId: 'version-1', status: 'READY' })
  })

  it('is idempotent: retrying the same idempotencyKey with the same payload returns the same versionId and creates no second version', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/t1', data: baseTemplate }])
    const deps = makeDeps(fake, ['version-1', 'version-2'])
    const first = await publishLessonVersion(deps, { templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '初版', idempotencyKey: 'key-1' })
    const second = await publishLessonVersion(deps, { templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '初版', idempotencyKey: 'key-1' })

    expect(second.versionId).toBe(first.versionId)
    expect(second.alreadyPublished).toBe(true)
    expect(fake.docs.has('lessonTemplates/t1/versions/version-2')).toBe(false)
  })

  it('rejects a retry under the same idempotencyKey whose payload (templateId/changeSummary) differs', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/t1', data: baseTemplate }])
    const deps = makeDeps(fake)
    await publishLessonVersion(deps, { templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '初版', idempotencyKey: 'key-1' })

    await expect(publishLessonVersion(deps, { templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '別の要約', idempotencyKey: 'key-1' }))
      .rejects.toThrow('Idempotency key payload mismatch')
  })

  it('rejects a retry under the same idempotencyKey/templateId/changeSummary but a different caller uid', async () => {
    // Regression test for Finding 4: the idempotency digest must include the
    // caller's uid, otherwise two different teachers in the same org could
    // reuse the same idempotency key against the same template and get each
    // other's replayed result.
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/t1', data: baseTemplate }])
    const deps = makeDeps(fake)
    await publishLessonVersion(deps, { templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '初版', idempotencyKey: 'key-1' })

    await expect(publishLessonVersion(deps, { templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-b', changeSummary: '初版', idempotencyKey: 'key-1' }))
      .rejects.toThrow('Idempotency key payload mismatch')
  })

  it('rejects when the template does not exist', async () => {
    const fake = makeFakeFirestore([])
    await expect(publishLessonVersion(makeDeps(fake), { templateId: 'missing', orgId: 'personal_teacher-a', uid: 'teacher-a', idempotencyKey: 'key-1' }))
      .rejects.toThrow('Lesson template not found')
  })

  it('rejects when the template does not belong to the expected organization', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/t1', data: baseTemplate }])
    await expect(publishLessonVersion(makeDeps(fake), { templateId: 't1', orgId: 'personal_teacher-b', uid: 'teacher-a', idempotencyKey: 'key-1' }))
      .rejects.toThrow('does not belong to the expected organization')
  })

  it('links the new version to the previously published version via parentVersionId', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/t1', data: { ...baseTemplate, currentPublishedVersionId: 'version-0', status: 'READY' } }])
    const result = await publishLessonVersion(makeDeps(fake, ['version-1']), {
      templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '改訂', idempotencyKey: 'key-2',
    })
    expect(fake.docs.get(`lessonTemplates/t1/versions/${result.versionId}`)).toMatchObject({ parentVersionId: 'version-0' })
  })
})
