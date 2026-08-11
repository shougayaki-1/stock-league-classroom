import { describe, expect, it } from 'vitest'
import { createLessonRun } from './createLessonRun'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  const activeLessonRunCounts = new Map<string, number>()
  docs.set('organizations/personal_teacher-a', { planId: 'FREE' })
  docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 100 } })
  return {
    docs,
    activeLessonRunCounts,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      countActiveLessonRuns: (orgId: string) => Promise<number>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      countActiveLessonRuns: async (orgId: string) => activeLessonRunCounts.get(orgId) ?? 0,
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
          dividendTriggerBatchIndexes: [], stockSplitTriggerBatchIndexes: [], dividendPerShareYen: 0, stockSplitRatio: 1,
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

  it('rejects creating a HOME_ECONOMICS run whose templateSnapshot has zero households', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-3', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-3/versions/v1', {
      templateId: 'tpl-3', orgId: 'personal_teacher-a',
      content: {
        schemaVersion: 1, title: 't', description: '', subject: 'HOME_ECONOMICS',
        homeEconomics: {
          households: [], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [], publicSupportPrograms: [],
          roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
          taxAndSocialInsuranceModelVersion: 1,
          economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 },
          borrowingAllowed: false,
          goalPackage: 'EMERGENCY_FUND',
          evaluationWeights: {
            lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2,
            diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15,
          },
        },
      },
    })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-3', orgId: 'personal_teacher-a',
      templateId: 'tpl-3', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('担当プロフィールが1件も設定されていません。')
  })
})

describe('createLessonRun quota enforcement', () => {
  it('rejects creation when the active lessonRun count has reached the plan limit', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 2 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 2)
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-x',
      lessonRunIdempotencyKey: 'idem-quota', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('この組織の同時授業・市場数の上限に達しています')
    expect(fake.docs.has('lessonRuns/run-x')).toBe(false)
  })

  it('allows creation when the active count is below the plan limit', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 2 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 1)
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-y',
      lessonRunIdempotencyKey: 'idem-quota-2', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })
    expect(result.created).toBe(true)
  })

  it('rejects when the organization has no planId', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('organizations/personal_teacher-a', {})
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-z',
      lessonRunIdempotencyKey: 'idem-quota-3', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('この組織にはプランが設定されていません')
  })

  it('rejects when planDefinitions does not have a matching document', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('organizations/personal_teacher-a', { planId: 'NONEXISTENT' })
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-w',
      lessonRunIdempotencyKey: 'idem-quota-4', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('この組織にはプランが設定されていません')
  })

  it('does not check the quota again for an idempotent retry', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const input = {
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-retry',
      lessonRunIdempotencyKey: 'idem-quota-retry', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    }
    const first = await createLessonRun(input)
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 0 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 1)
    const second = await createLessonRun(input)
    expect(second.lessonRunId).toBe(first.lessonRunId)
    expect(second.created).toBe(false)
  })

  it('allows a new run during the downgrade grace period even when the reduced limit is full', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 1 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 1)

    const result = await createLessonRun({
      firestore: fake as never,
      getDowngradeStatus: async () => ({ state: 'GRACE', graceEndsAtMillis: 2_000, violations: [{ key: 'concurrentLessonsAndMarkets', label: '同時授業・市場数', used: 1, limit: 1 }] }),
      generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-grace', lessonRunIdempotencyKey: 'idem-grace',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })

    expect(result.created).toBe(true)
  })

  it('rejects a new run when the concurrent resource is restricted', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 1 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 1)

    await expect(createLessonRun({
      firestore: fake as never,
      getDowngradeStatus: async () => ({ state: 'RESTRICTED', graceEndsAtMillis: 2_000, violations: [{ key: 'concurrentLessonsAndMarkets', label: '同時授業・市場数', used: 1, limit: 1 }] }),
      generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-restricted', lessonRunIdempotencyKey: 'idem-restricted',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('同時授業・市場数を整理する必要があります')
  })
})
