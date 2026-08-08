import { describe, expect, it } from 'vitest'
import { createLessonRun } from './createLessonRun'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('createLessonRun', () => {
  it('fixes the template snapshot and generates a randomSeed the caller never supplies', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'fixed-test-seed',
      generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-1',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })
    expect(result.created).toBe(true)
    const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`)
    expect(run).toMatchObject({
      orgId: 'personal_teacher-a', templateId: 'tpl-1', templateVersionId: 'v1',
      randomSeed: 'fixed-test-seed', restoreGeneration: 0, status: 'DRAFT',
      primaryTeacherUid: 'teacher-a', teacherRoles: { 'teacher-a': 'PRIMARY' },
    })
  })

  it('is idempotent per idempotencyKey: a retried call returns the same lessonRunId without creating a second run', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } })
    const input = { firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed', lessonRunIdempotencyKey: 'idem/with unsafe chars', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a' }
    const first = await createLessonRun(input)
    const second = await createLessonRun(input)
    expect(second.lessonRunId).toBe(first.lessonRunId)
    expect(second.created).toBe(false)
  })

  it('rejects reusing the same idempotencyKey for a different template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const base = { firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed', lessonRunIdempotencyKey: 'same-key', orgId: 'personal_teacher-a', primaryTeacherUid: 'teacher-a' }
    await createLessonRun({ ...base, templateId: 'tpl-1' })
    await expect(createLessonRun({ ...base, templateId: 'tpl-2' })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('rejects a published-version pointer that crosses template or organization ownership', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v-foreign' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v-foreign', { templateId: 'tpl-2', orgId: 'personal_teacher-b', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-foreign', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('Published version pointer mismatch')
  })

  it('rejects creating a SOCIAL_STUDIES run whose templateSnapshot has fewer than 3 companies', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-2', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-2/versions/v1', {
      templateId: 'tpl-2', orgId: 'personal_teacher-a',
      content: {
        schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES',
        socialStudiesMarket: {
          companies: [], informationItems: [], economicIndicators: [],
          batchIntervalSeconds: 3, priceSensitivityPreset: 'BALANCED', marketNoiseEnabled: true,
          resumeConfirmationSeconds: 30, companyDifficultyTier: 'STANDARD', indicatorDifficultyTier: 'STANDARD',
          tradingFeeYen: 0, dividendEnabled: false, stockSplitEnabled: false, bankruptcyEnabled: false,
          predictionEvaluationTarget: { type: 'AFTER_BATCHES', count: 20 },
          evaluationWeights: { operationResult: 0.1, predictionAccuracy: 0.3, informationUsage: 0.4, riskManagement: 0.1, reflection: 0.1 },
        },
      },
    })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-2', orgId: 'personal_teacher-a',
      templateId: 'tpl-2', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('企業は3社以上必要です。')
  })
})
