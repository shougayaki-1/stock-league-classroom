import { describe, expect, it, vi } from 'vitest'
import { createLessonRun } from './createLessonRun'

const makeFakeFirestore = (options: { transactionAttempts?: number } = {}) => {
  const docs = new Map<string, Record<string, unknown>>()
  const activeLessonRunCounts = new Map<string, number>()
  const collectionReads: string[] = []
  docs.set('organizations/personal_teacher-a', { planId: 'FREE' })
  docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 100 } })
  return {
    docs,
    activeLessonRunCounts,
    collectionReads,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      getCollection: (path: string) => Promise<Array<{ id: string; data: () => Record<string, unknown> }>>
      countActiveLessonRuns: (orgId: string) => Promise<number>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => {
      const attempts = options.transactionAttempts ?? 1
      let result = ''
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const pendingWrites = new Map<string, Record<string, unknown>>()
        let hasWritten = false
        const assertReadBeforeWrite = () => {
          if (hasWritten) throw new Error('Firestore transactions require all reads before writes')
        }
        result = await fn({
          get: async (path: string) => {
            assertReadBeforeWrite()
            return { exists: docs.has(path), data: () => docs.get(path) }
          },
          getCollection: async (path: string) => {
            assertReadBeforeWrite()
            collectionReads.push(path)
            const collectionDocuments = [...docs.entries()]
              .filter(([documentPath]) => documentPath.startsWith(`${path}/`))
              .filter(([documentPath]) => !documentPath.slice(path.length + 1).includes('/'))
              .map(([documentPath, data]) => ({ id: documentPath.slice(path.length + 1), data: () => data }))
            return collectionDocuments
          },
          countActiveLessonRuns: async (orgId: string) => {
            assertReadBeforeWrite()
            return activeLessonRunCounts.get(orgId) ?? 0
          },
          set: (path: string, data: Record<string, unknown>) => {
            hasWritten = true
            pendingWrites.set(path, data)
          },
        })
        if (attempt === attempts - 1) {
          for (const [path, data] of pendingWrites) docs.set(path, data)
        }
      }
      return result
    },
  }
}

const seedLinkedSchoolQuota = (
  fake: ReturnType<typeof makeFakeFirestore>,
  input: { guarantee: number; parentLimit: number; activeCount: number },
) => {
  fake.docs.set('organizations/school-1', { type: 'school', planId: 'SCHOOL', parentOrgId: 'parent-1' })
  fake.docs.set('organizations/parent-1', { type: 'parentOrg', planId: 'PARENT_ORG' })
  fake.docs.set('planDefinitions/SCHOOL', { limits: { concurrentLessonsAndMarkets: 100 } })
  fake.docs.set('planDefinitions/PARENT_ORG', { limits: { concurrentLessonsAndMarkets: input.parentLimit } })
  fake.docs.set('organizations/parent-1/schoolAllocations/school-1', {
    guaranteedConcurrentLessonsAndMarkets: input.guarantee,
    guaranteedTeacherSeats: 0,
  })
  fake.docs.set('lessonTemplates/tpl-school', { orgId: 'school-1', currentPublishedVersionId: 'v1' })
  fake.docs.set('lessonTemplates/tpl-school/versions/v1', {
    templateId: 'tpl-school', orgId: 'school-1', content: { subject: 'SOCIAL_STUDIES' },
  })
  fake.activeLessonRunCounts.set('school-1', input.activeCount)
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

  it('attaches a default phase graph (phases/initialPhaseId) to templateSnapshot so the lesson can later transition to RUNNING', async () => {
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
    const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`) as { templateSnapshot: { phases: Array<{ id: string; type: string }>; initialPhaseId: string; title: string } }
    expect(run.templateSnapshot.initialPhaseId).toBe('intro')
    expect(run.templateSnapshot.phases.map((phase) => phase.id)).toEqual(['intro', 'market', 'result', 'reflection'])
    // The rest of the original template content must still be preserved, not replaced.
    expect(run.templateSnapshot.title).toBe('t')
  })

  it('writes the fixed service-wide maxParticipants alongside the caller-provided expectedParticipants', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'fixed-test-seed',
      generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-2',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
      expectedParticipants: 42,
    })
    const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`)
    expect(run).toMatchObject({ maxParticipants: 80, expectedParticipants: 42 })
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

  it('allows the template creator to use their own PENDING template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-pending', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'PENDING' })
    fake.docs.set('lessonTemplates/tpl-pending/versions/v1', { templateId: 'tpl-pending', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-own-pending', orgId: 'personal_teacher-a', templateId: 'tpl-pending', primaryTeacherUid: 'teacher-a',
    })
    expect(result.created).toBe(true)
  })

  it('rejects another teacher using a PENDING template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-pending', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'PENDING' })
    fake.docs.set('lessonTemplates/tpl-pending/versions/v1', { templateId: 'tpl-pending', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-pending', orgId: 'personal_teacher-a', templateId: 'tpl-pending', primaryTeacherUid: 'teacher-b',
    })).rejects.toThrow('Template is not approved for use by other teachers')
  })

  it('rejects another teacher using a REJECTED template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-rejected', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'REJECTED' })
    fake.docs.set('lessonTemplates/tpl-rejected/versions/v1', { templateId: 'tpl-rejected', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-rejected', orgId: 'personal_teacher-a', templateId: 'tpl-rejected', primaryTeacherUid: 'teacher-b',
    })).rejects.toThrow('Template is not approved for use by other teachers')
  })

  it('allows another teacher to use an APPROVED template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-approved', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'APPROVED' })
    fake.docs.set('lessonTemplates/tpl-approved/versions/v1', { templateId: 'tpl-approved', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-approved', orgId: 'personal_teacher-a', templateId: 'tpl-approved', primaryTeacherUid: 'teacher-b',
    })
    expect(result.created).toBe(true)
  })

  it('allows another teacher to use a template with no approvalStatus set (pre-existing data)', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-legacy', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a' })
    fake.docs.set('lessonTemplates/tpl-legacy/versions/v1', { templateId: 'tpl-legacy', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-legacy', orgId: 'personal_teacher-a', templateId: 'tpl-legacy', primaryTeacherUid: 'teacher-b',
    })
    expect(result.created).toBe(true)
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

  it('keeps the existing organization plan limit for a school without a parent organization', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('organizations/school-standalone', { type: 'school', planId: 'SCHOOL' })
    fake.docs.set('planDefinitions/SCHOOL', { limits: { concurrentLessonsAndMarkets: 1 } })
    fake.docs.set('lessonTemplates/tpl-standalone', {
      orgId: 'school-standalone', currentPublishedVersionId: 'v1',
    })
    fake.docs.set('lessonTemplates/tpl-standalone/versions/v1', {
      templateId: 'tpl-standalone', orgId: 'school-standalone', content: { subject: 'SOCIAL_STUDIES' },
    })
    fake.activeLessonRunCounts.set('school-standalone', 1)

    await expect(createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'seed-standalone',
      generateLessonRunId: () => 'run-standalone',
      lessonRunIdempotencyKey: 'idem-standalone',
      orgId: 'school-standalone', templateId: 'tpl-standalone', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('この組織の同時授業・市場数の上限に達しています')

    expect(fake.collectionReads).toEqual([])
  })

  it('creates a linked-school run within its guarantee without reserving parent shared quota', async () => {
    const fake = makeFakeFirestore()
    seedLinkedSchoolQuota(fake, { guarantee: 2, parentLimit: 3, activeCount: 1 })

    const result = await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'seed-within-guarantee',
      generateLessonRunId: () => 'run-within-guarantee',
      lessonRunIdempotencyKey: 'idem-within-guarantee',
      orgId: 'school-1', templateId: 'tpl-school', primaryTeacherUid: 'teacher-a',
    })

    expect(result).toEqual({ lessonRunId: 'run-within-guarantee', created: true })
    expect([...fake.docs.keys()].filter((path) => path.includes('/quotaReservations/'))).toEqual([])
    expect(fake.collectionReads).toEqual([])
  })

  it('allows a linked-school run within its guarantee even when the parent contract has ended', async () => {
    const fake = makeFakeFirestore()
    seedLinkedSchoolQuota(fake, { guarantee: 2, parentLimit: 3, activeCount: 1 })
    fake.docs.set('organizations/parent-1', { type: 'parentOrg', planId: 'PARENT_ORG', parentContractState: 'ENDED' })

    await expect(createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'seed-ended-guarantee',
      generateLessonRunId: () => 'run-ended-guarantee',
      lessonRunIdempotencyKey: 'idem-ended-guarantee',
      orgId: 'school-1', templateId: 'tpl-school', primaryTeacherUid: 'teacher-a',
    })).resolves.toEqual({ lessonRunId: 'run-ended-guarantee', created: true })
  })

  it('rejects a linked-school run requiring a shared reservation when the parent contract has ended', async () => {
    const fake = makeFakeFirestore()
    seedLinkedSchoolQuota(fake, { guarantee: 1, parentLimit: 3, activeCount: 1 })
    fake.docs.set('organizations/parent-1', { type: 'parentOrg', planId: 'PARENT_ORG', parentContractState: 'ENDED' })

    await expect(createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'seed-ended-shared',
      generateLessonRunId: () => 'run-ended-shared',
      lessonRunIdempotencyKey: 'idem-ended-shared',
      orgId: 'school-1', templateId: 'tpl-school', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('親組織の契約が終了しているため共有枠を利用できません')

    expect(fake.docs.has('lessonRuns/run-ended-shared')).toBe(false)
  })

  it('reserves parent shared quota when the new linked-school run exceeds its guarantee', async () => {
    const fake = makeFakeFirestore()
    seedLinkedSchoolQuota(fake, { guarantee: 1, parentLimit: 3, activeCount: 1 })

    await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'seed-shared',
      generateLessonRunId: () => 'run-shared',
      lessonRunIdempotencyKey: 'idem-shared',
      orgId: 'school-1', templateId: 'tpl-school', primaryTeacherUid: 'teacher-a',
      now: () => 'NOW',
    })

    expect(fake.docs.get('organizations/parent-1/quotaReservations/concurrentLessonsAndMarkets:school-1:run-shared')).toEqual({
      reservationId: 'concurrentLessonsAndMarkets:school-1:run-shared',
      resourceKey: 'concurrentLessonsAndMarkets',
      schoolOrgId: 'school-1',
      targetId: 'run-shared',
      createdAt: 'NOW',
    })
    expect(fake.docs.has('lessonRuns/run-shared')).toBe(true)
  })

  it('throws a pure shared-quota Error and writes nothing when the parent shared remainder is exhausted', async () => {
    const fake = makeFakeFirestore()
    seedLinkedSchoolQuota(fake, { guarantee: 1, parentLimit: 2, activeCount: 1 })
    fake.docs.set('organizations/parent-1/schoolAllocations/school-2', {
      guaranteedConcurrentLessonsAndMarkets: 1,
      guaranteedTeacherSeats: 0,
    })

    await expect(createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'seed-exhausted',
      generateLessonRunId: () => 'run-exhausted',
      lessonRunIdempotencyKey: 'idem-exhausted',
      orgId: 'school-1', templateId: 'tpl-school', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow(new Error('共有枠が不足しています'))

    expect(fake.docs.has('lessonRuns/run-exhausted')).toBe(false)
    expect([...fake.docs.keys()].some((path) => path.includes('/quotaReservations/'))).toBe(false)
  })

  it('prioritizes a matching RESTRICTED downgrade violation over parent shared-quota exhaustion', async () => {
    const fake = makeFakeFirestore()
    seedLinkedSchoolQuota(fake, { guarantee: 1, parentLimit: 1, activeCount: 1 })

    await expect(createLessonRun({
      firestore: fake as never,
      getDowngradeStatus: async () => ({
        state: 'RESTRICTED',
        graceEndsAtMillis: 2_000,
        violations: [{ key: 'concurrentLessonsAndMarkets', label: '同時授業・市場数', used: 1, limit: 1 }],
      }),
      generateRandomSeed: () => 'seed-restricted-shared',
      generateLessonRunId: () => 'run-restricted-shared',
      lessonRunIdempotencyKey: 'idem-restricted-shared',
      orgId: 'school-1', templateId: 'tpl-school', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('同時授業・市場数を整理する必要があります')

    expect(fake.collectionReads).toEqual([])
  })

  it('uses one lessonRunId and one reservation across transaction and idempotent retries', async () => {
    const fake = makeFakeFirestore({ transactionAttempts: 2 })
    seedLinkedSchoolQuota(fake, { guarantee: 1, parentLimit: 2, activeCount: 1 })
    const generateLessonRunId = vi.fn()
      .mockReturnValueOnce('run-stable')
      .mockReturnValueOnce('run-must-not-be-used')
    const generateRandomSeed = vi.fn()
      .mockReturnValueOnce('seed-stable')
      .mockReturnValueOnce('seed-must-not-be-used')
    const input = {
      firestore: fake as never,
      generateRandomSeed,
      generateLessonRunId,
      lessonRunIdempotencyKey: 'idem-stable',
      orgId: 'school-1', templateId: 'tpl-school', primaryTeacherUid: 'teacher-a',
    }

    const first = await createLessonRun(input)
    const second = await createLessonRun(input)

    expect(first).toEqual({ lessonRunId: 'run-stable', created: true })
    expect(second).toEqual({ lessonRunId: 'run-stable', created: false })
    expect(generateLessonRunId).toHaveBeenCalledTimes(2)
    expect(generateRandomSeed).toHaveBeenCalledTimes(2)
    expect([...fake.docs.keys()].filter((path) => path.startsWith('lessonRuns/'))).toEqual(['lessonRuns/run-stable'])
    expect([...fake.docs.keys()].filter((path) => path.includes('/quotaReservations/'))).toEqual([
      'organizations/parent-1/quotaReservations/concurrentLessonsAndMarkets:school-1:run-stable',
    ])
    expect(fake.docs.get('lessonRuns/run-stable')).toMatchObject({ randomSeed: 'seed-stable' })
  })
})

describe('coreActivityMinutes', () => {
  it('教材の coreActivityMinutes を中核フェーズの制限時間にする', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', {
      templateId: 'tpl-1', orgId: 'personal_teacher-a',
      content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES', coreActivityMinutes: 20 },
    })

    const result = await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'fixed-test-seed',
      generateLessonRunId: () => 'run-core-minutes',
      lessonRunIdempotencyKey: 'idem-core-minutes',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })

    const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`) as {
      templateSnapshot: { phases: Array<{ id: string; durationSeconds?: number }> }
    }
    const market = run.templateSnapshot.phases.find((phase) => phase.id === 'market')
    expect(market?.durationSeconds).toBe(20 * 60)
  })
})
