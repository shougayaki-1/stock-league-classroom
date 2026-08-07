import { describe, expect, it } from 'vitest'
import { validateLessonForStart, type LessonForStartValidation, type LessonPhase } from './validation'

const infoPhase: LessonPhase = {
  id: 'intro',
  type: 'INTRO',
  progression: 'TEACHER_CONTROLLED',
  nextPhaseIds: ['market'],
  displayConfig: { title: '導入' },
}

const marketPhase: LessonPhase = {
  id: 'market',
  type: 'MARKET',
  progression: 'TIMED',
  durationSeconds: 600,
  nextPhaseIds: ['result'],
  displayConfig: { title: '市場' },
}

const resultPhase: LessonPhase = {
  id: 'result',
  type: 'RESULT',
  progression: 'AUTOMATIC',
  nextPhaseIds: ['reflection'],
  displayConfig: { title: '結果' },
}

const reflectionPhase: LessonPhase = {
  id: 'reflection',
  type: 'REFLECTION',
  progression: 'SUBMISSION_BASED',
  requiredCompletionRatio: 0.8,
  nextPhaseIds: [],
  displayConfig: { title: '振り返り' },
}

const validSocialStudiesLesson: LessonForStartValidation = {
  subject: 'SOCIAL_STUDIES',
  phases: [infoPhase, marketPhase, resultPhase, reflectionPhase],
}

describe('validateLessonForStart', () => {
  it('returns no problems for a well-formed lesson', () => {
    expect(validateLessonForStart(validSocialStudiesLesson)).toEqual([])
  })

  it('flags HOME_ECONOMICS lessons that contain a MARKET phase (矛盾解消G)', () => {
    const homeLessonWithMarket: LessonForStartValidation = {
      ...validSocialStudiesLesson,
      subject: 'HOME_ECONOMICS',
    }
    expect(validateLessonForStart(homeLessonWithMarket)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'HOME_ECONOMICS_MARKET_FORBIDDEN' }),
    )
  })

  it('flags a lesson whose phase graph never reaches a RESULT/REFLECTION phase', () => {
    const lessonWithoutTerminalPhase: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [
        { ...infoPhase, nextPhaseIds: ['dead-end'] },
        { id: 'dead-end', type: 'DISCUSSION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [], displayConfig: {} },
      ],
    }
    expect(validateLessonForStart(lessonWithoutTerminalPhase)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'NO_TERMINAL_PHASE' }),
    )
  })

  it('warns (not errors) when the total configured duration exceeds the provisional threshold', () => {
    const overlongLesson: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [
        { ...marketPhase, id: 'market-1', durationSeconds: 6000, nextPhaseIds: ['market-2'] },
        { ...marketPhase, id: 'market-2', durationSeconds: 6000, nextPhaseIds: ['result'] },
        resultPhase,
        reflectionPhase,
      ],
    }
    const problems = validateLessonForStart(overlongLesson)
    expect(problems).toContainEqual(expect.objectContaining({ severity: 'WARNING', code: 'DURATION_EXCEEDED' }))
    // A warning must never also be reported as blocking.
    expect(problems.some((p) => p.code === 'DURATION_EXCEEDED' && p.severity === 'ERROR')).toBe(false)
  })

  it('requires a positive durationSeconds when progression is TIMED', () => {
    const lesson: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [
        { ...marketPhase, durationSeconds: undefined, nextPhaseIds: ['result'] },
        resultPhase,
      ],
    }
    expect(validateLessonForStart(lesson)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'PHASE_DURATION_REQUIRED' }),
    )
  })

  it('rejects a non-positive durationSeconds when progression is TIMED', () => {
    const lesson: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [
        { ...marketPhase, durationSeconds: 0, nextPhaseIds: ['result'] },
        resultPhase,
      ],
    }
    expect(validateLessonForStart(lesson)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'PHASE_DURATION_REQUIRED' }),
    )
  })

  it('requires requiredCompletionRatio in [0, 1] when progression is SUBMISSION_BASED', () => {
    const missingRatio: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [{ ...reflectionPhase, requiredCompletionRatio: undefined }],
    }
    expect(validateLessonForStart(missingRatio)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'PHASE_COMPLETION_RATIO_INVALID' }),
    )

    const outOfRangeRatio: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [{ ...reflectionPhase, requiredCompletionRatio: 1.5 }],
    }
    expect(validateLessonForStart(outOfRangeRatio)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'PHASE_COMPLETION_RATIO_INVALID' }),
    )
  })

  it('rejects duplicate phase ids', () => {
    const lesson: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [resultPhase, { ...reflectionPhase, id: 'result' }],
    }
    expect(validateLessonForStart(lesson)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'DUPLICATE_PHASE_ID' }),
    )
  })

  it('requires student-facing display info on every phase', () => {
    const lesson: LessonForStartValidation = {
      subject: 'SOCIAL_STUDIES',
      phases: [{ ...resultPhase, displayConfig: undefined }],
    }
    expect(validateLessonForStart(lesson)).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'MISSING_STUDENT_FACING_INFO' }),
    )
  })
})
