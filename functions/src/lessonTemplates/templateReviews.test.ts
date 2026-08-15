import { describe, expect, it, vi } from 'vitest'
import { isEligibleToReviewTemplate, listTemplateReviews, submitTemplateReview } from './templateReviews'

describe('isEligibleToReviewTemplate', () => {
  it('is eligible when the teacher directly completed a lessonRun for this exact template/version', async () => {
    const deps = {
      getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue(['v1', 'v2']),
      getOwnDuplicateTemplateIds: vi.fn(),
    }
    await expect(isEligibleToReviewTemplate(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-a' })).resolves.toBe(true)
    expect(deps.getOwnDuplicateTemplateIds).not.toHaveBeenCalled()
  })

  it('is eligible via a duplicate the teacher made and completed themselves', async () => {
    const deps = {
      getCompletedRunTemplateVersionIds: vi.fn()
        .mockResolvedValueOnce([]) // direct check on the original template: none
        .mockResolvedValueOnce(['copy-v1']), // check on the duplicate template: completed
      getOwnDuplicateTemplateIds: vi.fn().mockResolvedValue(['copy-1']),
    }
    await expect(isEligibleToReviewTemplate(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-b' })).resolves.toBe(true)
    expect(deps.getOwnDuplicateTemplateIds).toHaveBeenCalledWith('t1', 'v1', 'teacher-b')
  })

  it('is not eligible with no direct or duplicate-based completion', async () => {
    const deps = {
      getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue([]),
      getOwnDuplicateTemplateIds: vi.fn().mockResolvedValue([]),
    }
    await expect(isEligibleToReviewTemplate(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-c' })).resolves.toBe(false)
  })
})

const makeDeps = (overrides: Partial<Parameters<typeof submitTemplateReview>[0]> = {}) => ({
  getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue(['v1']),
  getOwnDuplicateTemplateIds: vi.fn().mockResolvedValue([]),
  getReview: vi.fn().mockResolvedValue({ exists: false }),
  setReview: vi.fn().mockResolvedValue(undefined),
  listReviewsForVersion: vi.fn().mockResolvedValue([{ clarityRating: 4, easeOfImplementationRating: 5, studentResponseRating: 3 }]),
  updateTemplateAggregate: vi.fn().mockResolvedValue(undefined),
  now: () => 'NOW',
  ...overrides,
})

describe('submitTemplateReview', () => {
  it('throws when the caller is not eligible', async () => {
    const deps = makeDeps({ getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue([]) })
    await expect(submitTemplateReview(deps, {
      templateId: 't1', versionId: 'v1', uid: 'teacher-a',
      clarityRating: 5, easeOfImplementationRating: 5, studentResponseRating: 5, comment: null,
    })).rejects.toThrow('Not eligible to review this template version')
    expect(deps.setReview).not.toHaveBeenCalled()
  })

  it('sets createdAt on first submission and preserves it on resubmission', async () => {
    const depsFirst = makeDeps()
    await submitTemplateReview(depsFirst, { templateId: 't1', versionId: 'v1', uid: 'teacher-a', clarityRating: 4, easeOfImplementationRating: 4, studentResponseRating: 4, comment: 'よかった' })
    expect(depsFirst.setReview).toHaveBeenCalledWith('v1', 'teacher-a', expect.objectContaining({ createdAt: 'NOW', updatedAt: 'NOW', comment: 'よかった' }))

    const depsResubmit = makeDeps({ getReview: vi.fn().mockResolvedValue({ exists: true, data: { createdAt: 'ORIGINAL' } }), now: () => 'LATER' })
    await submitTemplateReview(depsResubmit, { templateId: 't1', versionId: 'v1', uid: 'teacher-a', clarityRating: 5, easeOfImplementationRating: 5, studentResponseRating: 5, comment: null })
    expect(depsResubmit.setReview).toHaveBeenCalledWith('v1', 'teacher-a', expect.objectContaining({ createdAt: 'ORIGINAL', updatedAt: 'LATER' }))
  })

  it('recomputes the template aggregate from all reviews for the version', async () => {
    const deps = makeDeps({
      listReviewsForVersion: vi.fn().mockResolvedValue([
        { clarityRating: 4, easeOfImplementationRating: 2, studentResponseRating: 5 },
        { clarityRating: 2, easeOfImplementationRating: 4, studentResponseRating: 3 },
      ]),
    })
    await submitTemplateReview(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-a', clarityRating: 4, easeOfImplementationRating: 2, studentResponseRating: 5, comment: null })
    expect(deps.updateTemplateAggregate).toHaveBeenCalledWith('t1', {
      reviewCount: 2, averageClarityRating: 3, averageEaseOfImplementationRating: 3, averageStudentResponseRating: 4,
    })
  })
})

describe('listTemplateReviews', () => {
  it('delegates to listReviewsForVersion', async () => {
    const deps = { listReviewsForVersion: vi.fn().mockResolvedValue([{ comment: 'よい教材でした' }]) }
    await expect(listTemplateReviews(deps, 'v1')).resolves.toEqual([{ comment: 'よい教材でした' }])
    expect(deps.listReviewsForVersion).toHaveBeenCalledWith('v1')
  })
})
