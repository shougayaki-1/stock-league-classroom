import { describe, expect, it } from 'vitest'
import { buildLessonSurveySchema, SURVEY_QUESTION_CATALOG } from './schema'

describe('buildLessonSurveySchema (Step 2)', () => {
  it('accepts a schema covering the full catalog (understanding, weighted info, judgment change, result gap, improvement, clarity, one free-text)', () => {
    const schema = buildLessonSurveySchema({
      lessonRunId: 'run-1',
      questions: [
        { type: 'COMPREHENSION', required: true },
        { type: 'IMPORTANT_INFO', required: true },
        { type: 'JUDGMENT_CHANGED', required: true },
        { type: 'RESULT_GAP', required: false },
        { type: 'IMPROVEMENT', required: false },
        { type: 'CLARITY', required: true },
        { type: 'FREE_TEXT', required: false },
      ],
    })
    expect(schema.questions).toHaveLength(7)
    expect(schema.estimatedSeconds).toBeGreaterThan(0)
  })

  it('rejects an empty question list', () => {
    expect(() => buildLessonSurveySchema({ lessonRunId: 'run-1', questions: [] })).toThrow()
  })

  it('rejects more than one free-text question', () => {
    expect(() => buildLessonSurveySchema({
      lessonRunId: 'run-1',
      questions: [
        { type: 'FREE_TEXT', required: false },
        { type: 'IMPROVEMENT', required: false },
      ],
    })).not.toThrow() // IMPROVEMENT is a distinct free-response question, not FREE_TEXT
    expect(() => buildLessonSurveySchema({
      lessonRunId: 'run-1',
      questions: [
        { type: 'FREE_TEXT', required: false },
        { type: 'FREE_TEXT', required: false },
      ],
    })).toThrow(/free-text|自由記述/)
  })

  it('rejects a duplicate question type', () => {
    expect(() => buildLessonSurveySchema({
      lessonRunId: 'run-1',
      questions: [
        { type: 'COMPREHENSION', required: true },
        { type: 'COMPREHENSION', required: true },
      ],
    })).toThrow()
  })

  it('rejects an unknown question type', () => {
    expect(() => buildLessonSurveySchema({
      lessonRunId: 'run-1',
      questions: [{ type: 'NOT_A_REAL_TYPE', required: true } as never],
    })).toThrow()
  })

  it('rejects when the required questions alone exceed the 5-minute budget', () => {
    const allRequired = Object.keys(SURVEY_QUESTION_CATALOG).map((type) => ({ type: type as never, required: true }))
    expect(() => buildLessonSurveySchema({ lessonRunId: 'run-1', questions: allRequired })).toThrow(/5分|budget/i)
  })

  it('allows the same catalog when the slow questions are optional instead of required', () => {
    const allOptional = Object.keys(SURVEY_QUESTION_CATALOG).map((type) => ({ type: type as never, required: false }))
    expect(() => buildLessonSurveySchema({ lessonRunId: 'run-1', questions: allOptional })).not.toThrow()
  })
})
