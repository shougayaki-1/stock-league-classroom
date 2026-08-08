import { describe, expect, it } from 'vitest'
import { submitSurvey, type SurveyFirestoreDeps } from './submitSurvey'

interface StoredDoc { data: Record<string, unknown> }

const makeFirestore = () => {
  const store = new Map<string, StoredDoc>()
  const firestore: SurveyFirestoreDeps['firestore'] = {
    runTransaction: async (fn) => fn({
      get: async (path: string) => {
        const doc = store.get(path)
        return { exists: !!doc, data: () => doc?.data }
      },
      set: (path: string, data: Record<string, unknown>) => { store.set(path, { data }) },
    }),
  }
  return { firestore, store }
}

const baseInput = {
  lessonRunId: 'run-1',
  resultId: 'result-1',
  participantId: 'p-1' as const,
  answers: { COMPREHENSION: 5, IMPROVEMENT: '次はもっと調べたい' },
  idempotencyKey: 'key-1',
}

describe('submitSurvey (Step 3)', () => {
  it('rejects a survey response missing lessonRunId/resultId/participantId', async () => {
    const { firestore } = makeFirestore()
    // @ts-expect-error deliberately missing participantId for this test
    await expect(submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, { ...baseInput, participantId: undefined }))
      .rejects.toThrow()
  })

  it('creates a new LessonSurveyResponse at revision 1', async () => {
    const { firestore } = makeFirestore()
    const result = await submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, baseInput)
    expect(result.revision).toBe(1)
    expect(result.deduplicated).toBe(false)
  })

  it('is idempotent for the exact same idempotencyKey + payload', async () => {
    const { firestore } = makeFirestore()
    const first = await submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, baseInput)
    const second = await submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, baseInput)
    expect(second.deduplicated).toBe(true)
    expect(second.revision).toBe(first.revision)
  })

  it('upserts a resubmission from the same participant as a new revision (fresh idempotencyKey)', async () => {
    const { firestore } = makeFirestore()
    await submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, baseInput)
    const resubmitted = await submitSurvey(
      { firestore, orgId: 'org-1', now: () => 'now' },
      { ...baseInput, answers: { COMPREHENSION: 3 }, idempotencyKey: 'key-2' },
    )
    expect(resubmitted.revision).toBe(2)
    expect(resubmitted.deduplicated).toBe(false)
  })

  it('rejects a stale idempotency key whose payload no longer matches (payload mismatch under key reuse)', async () => {
    const { firestore } = makeFirestore()
    await submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, baseInput)
    await expect(
      submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, { ...baseInput, answers: { COMPREHENSION: 1 } }),
    ).rejects.toThrow(/Idempotency key payload mismatch/)
  })

  it('rejects a stale expectedRevision as a conflict', async () => {
    const { firestore } = makeFirestore()
    await submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, baseInput)
    await expect(
      submitSurvey({ firestore, orgId: 'org-1', now: () => 'now' }, {
        ...baseInput, answers: { COMPREHENSION: 2 }, idempotencyKey: 'key-3', expectedRevision: 5,
      }),
    ).rejects.toThrow(/revision/i)
  })

  describe('absent-student access (Step 3: "limited membership reissue")', () => {
    it('allows a participant whose resolveParticipant status is ABSENT to submit', async () => {
      const { firestore } = makeFirestore()
      const result = await submitSurvey(
        { firestore, orgId: 'org-1', now: () => 'now', resolveParticipant: async () => ({ orgId: 'org-1', status: 'ABSENT' }) },
        baseInput,
      )
      expect(result.deduplicated).toBe(false)
    })

    it('rejects a SUSPENDED participant', async () => {
      const { firestore } = makeFirestore()
      await expect(submitSurvey(
        { firestore, orgId: 'org-1', now: () => 'now', resolveParticipant: async () => ({ orgId: 'org-1', status: 'SUSPENDED' }) },
        baseInput,
      )).rejects.toThrow(/suspend/i)
    })

    it('rejects when no participant record exists for this lessonRun', async () => {
      const { firestore } = makeFirestore()
      await expect(submitSurvey(
        { firestore, orgId: 'org-1', now: () => 'now', resolveParticipant: async () => undefined },
        baseInput,
      )).rejects.toThrow(/not found|participant/i)
    })
  })
})
