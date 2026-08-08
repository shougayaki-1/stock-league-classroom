import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LessonReflectionPage } from './LessonReflectionPage'
import { mapReflectionMethodToInputType } from './lessonReflectionMapping'

describe('mapReflectionMethodToInputType (Step 4 mapping)', () => {
  it.each([
    ['CHOICE_ONLY', 'SINGLE_CHOICE'],
    ['SHORT_TEXT', 'SHORT_TEXT'],
    ['TEAM_DISCUSSION', 'SHORT_TEXT'],
    ['INDIVIDUAL_THEN_TEAM', 'SHORT_TEXT'],
    ['POST_LESSON_SURVEY', 'SURVEY'],
  ] as const)('maps %s to %s', (method, expected) => {
    expect(mapReflectionMethodToInputType(method)).toBe(expected)
  })
})

describe('LessonReflectionPage', () => {
  const baseProps = {
    lessonTitle: '株式投資シミュレーション',
    displayName: 'たなか',
    teamName: 'チームA',
  }

  it('renders a single-choice widget for CHOICE_ONLY', () => {
    render(<LessonReflectionPage
      {...baseProps}
      reflectionMethod="CHOICE_ONLY"
      inputConfig={{ type: 'SINGLE_CHOICE', options: ['理解できた', '難しかった'] }}
      value={undefined}
      onChange={vi.fn()}
    />)
    expect(screen.getByText('理解できた')).toBeInTheDocument()
    expect(screen.getByText('難しかった')).toBeInTheDocument()
  })

  it('renders a short-text widget for SHORT_TEXT', () => {
    render(<LessonReflectionPage
      {...baseProps}
      reflectionMethod="SHORT_TEXT"
      inputConfig={{ type: 'SHORT_TEXT', maxLength: 200 }}
      value={undefined}
      onChange={vi.fn()}
    />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders a team badge and discussion instruction for TEAM_DISCUSSION', () => {
    render(<LessonReflectionPage
      {...baseProps}
      reflectionMethod="TEAM_DISCUSSION"
      inputConfig={{ type: 'SHORT_TEXT', maxLength: 200 }}
      value={undefined}
      onChange={vi.fn()}
    />)
    expect(screen.getByText(/チームで話し合って/)).toBeInTheDocument()
    expect(screen.getByText('チームの回答')).toBeInTheDocument()
  })

  it('renders both an individual and a team widget for INDIVIDUAL_THEN_TEAM, in that order', () => {
    render(<LessonReflectionPage
      {...baseProps}
      reflectionMethod="INDIVIDUAL_THEN_TEAM"
      inputConfig={{ type: 'SHORT_TEXT', maxLength: 200 }}
      value={undefined}
      onChange={vi.fn()}
      teamInputConfig={{ type: 'SHORT_TEXT', maxLength: 200 }}
      teamValue={undefined}
      onTeamChange={vi.fn()}
    />)
    expect(screen.getByText(/まず自分の考え/)).toBeInTheDocument()
    expect(screen.getByText(/チームで話し合った/)).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })

  it('renders the survey questions for POST_LESSON_SURVEY and calls onSubmitSurvey', () => {
    const onSubmitSurvey = vi.fn()
    render(<LessonReflectionPage
      {...baseProps}
      reflectionMethod="POST_LESSON_SURVEY"
      surveyQuestions={[
        { type: 'COMPREHENSION', required: true },
        { type: 'IMPROVEMENT', required: false },
      ]}
      surveyAnswers={{}}
      onSurveyAnswerChange={vi.fn()}
      onSubmitSurvey={onSubmitSurvey}
    />)
    expect(screen.getByText(/どれくらい理解できました/)).toBeInTheDocument()
    expect(screen.getByText(/次に活かせる改善点/)).toBeInTheDocument()
    screen.getByRole('button', { name: 'アンケートを送信する' }).click()
    expect(onSubmitSurvey).toHaveBeenCalledOnce()
  })

  it('shows a submitted confirmation and hides the questions once surveySubmitted is true', () => {
    render(<LessonReflectionPage
      {...baseProps}
      reflectionMethod="POST_LESSON_SURVEY"
      surveyQuestions={[{ type: 'COMPREHENSION', required: true }]}
      surveySubmitted
    />)
    expect(screen.getByText(/送信しました/)).toBeInTheDocument()
    expect(screen.queryByText(/どれくらい理解できました/)).not.toBeInTheDocument()
  })

  it('never renders another team\'s name (no prop channel exists for it)', () => {
    render(<LessonReflectionPage
      {...baseProps}
      reflectionMethod="SHORT_TEXT"
      inputConfig={{ type: 'SHORT_TEXT', maxLength: 200 }}
      value={undefined}
      onChange={vi.fn()}
    />)
    expect(screen.getByText('チームA')).toBeInTheDocument()
  })
})
