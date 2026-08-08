import { describe, expect, it } from 'vitest'
import { duplicateLessonTemplate } from './duplicateLessonTemplate'

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

const makeDeps = (fake: ReturnType<typeof makeFakeFirestore>, uuids: string[] = ['template-copy-1']) => {
  let call = 0
  return {
    firestore: fake as never,
    randomUUID: () => uuids[call++] ?? `template-copy-${call}`,
  }
}

const sourceContent = {
  schemaVersion: 1,
  title: '元の授業',
  description: '元の説明',
  subject: 'SOCIAL_STUDIES' as const,
}

const sourceVersion = {
  id: 'version-1',
  templateId: 'source-template-1',
  orgId: 'org-source',
  schemaVersion: 1,
  content: sourceContent,
  createdByUid: 'teacher-source',
  createdAt: 'sometime',
  immutable: true,
}

describe('duplicateLessonTemplate', () => {
  it('carries over title/description/subject from the source version into a new PRIVATE DRAFT template owned by the target org/caller', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion }])
    const result = await duplicateLessonTemplate(makeDeps(fake), {
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      targetOrgId: 'org-target',
      uid: 'teacher-target',
      confirmedOverrides: {},
      idempotencyKey: 'key-1',
    })

    expect(result.templateId).toBe('template-copy-1')
    expect(result.alreadyDuplicated).toBe(false)

    const newTemplate = fake.docs.get('lessonTemplates/template-copy-1')
    expect(newTemplate).toMatchObject({
      orgId: 'org-target',
      createdByUid: 'teacher-target',
      status: 'DRAFT',
      visibility: 'PRIVATE',
      currentPublishedVersionId: null,
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      draft: sourceContent,
    })
  })

  it('deep clones the source content so the new draft never shares object references with the source version', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion }])
    await duplicateLessonTemplate(makeDeps(fake), {
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      targetOrgId: 'org-target',
      uid: 'teacher-target',
      confirmedOverrides: {},
      idempotencyKey: 'key-1',
    })

    const newTemplate = fake.docs.get('lessonTemplates/template-copy-1')
    expect(newTemplate?.draft).toEqual(sourceContent)
    expect(newTemplate?.draft).not.toBe(sourceContent)
  })

  it('is idempotent: retrying the same idempotencyKey with the same payload returns the same templateId and creates no second template', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion }])
    const deps = makeDeps(fake, ['template-copy-1', 'template-copy-2'])
    const input = {
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      targetOrgId: 'org-target',
      uid: 'teacher-target',
      confirmedOverrides: {},
      idempotencyKey: 'key-1',
    }
    const first = await duplicateLessonTemplate(deps, input)
    const second = await duplicateLessonTemplate(deps, input)

    expect(second.templateId).toBe(first.templateId)
    expect(second.alreadyDuplicated).toBe(true)
    expect(fake.docs.has('lessonTemplates/template-copy-2')).toBe(false)
  })

  it('rejects a retry under the same idempotencyKey whose payload (sourceTemplateId/sourceVersionId/confirmedOverrides) differs', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion }])
    const deps = makeDeps(fake)
    await duplicateLessonTemplate(deps, {
      sourceTemplateId: 'source-template-1', sourceVersionId: 'version-1', targetOrgId: 'org-target',
      uid: 'teacher-target', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })

    await expect(duplicateLessonTemplate(deps, {
      sourceTemplateId: 'source-template-1', sourceVersionId: 'version-2', targetOrgId: 'org-target',
      uid: 'teacher-target', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('rejects a retry under the same idempotencyKey/payload but a different caller uid', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion }])
    const deps = makeDeps(fake)
    await duplicateLessonTemplate(deps, {
      sourceTemplateId: 'source-template-1', sourceVersionId: 'version-1', targetOrgId: 'org-target',
      uid: 'teacher-target', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })

    await expect(duplicateLessonTemplate(deps, {
      sourceTemplateId: 'source-template-1', sourceVersionId: 'version-1', targetOrgId: 'org-target',
      uid: 'teacher-other', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('throws when the source version does not exist', async () => {
    const fake = makeFakeFirestore([])
    await expect(duplicateLessonTemplate(makeDeps(fake), {
      sourceTemplateId: 'source-template-1', sourceVersionId: 'missing-version', targetOrgId: 'org-target',
      uid: 'teacher-target', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })).rejects.toThrow('Source lesson version not found')
  })

  it('throws when the source version does not belong to the given sourceTemplateId', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/wrong-template/versions/version-1', data: sourceVersion }])
    await expect(duplicateLessonTemplate(makeDeps(fake), {
      sourceTemplateId: 'wrong-template', sourceVersionId: 'version-1', targetOrgId: 'org-target',
      uid: 'teacher-target', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })).rejects.toThrow('Source lesson version does not belong to the expected template')
  })
})
