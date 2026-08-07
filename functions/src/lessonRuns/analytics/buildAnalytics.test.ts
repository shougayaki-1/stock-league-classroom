import { describe, expect, it } from 'vitest'
import { buildLessonAnalytics, type AnalyticsEvent, type AnalyticsResponse, type AnalyticsSurveyResponse } from './buildAnalytics'

const response = (overrides: Partial<AnalyticsResponse> = {}): AnalyticsResponse => ({
  id: 'resp-1',
  participantId: 'p-1',
  status: 'CONFIRMED',
  rationaleInformationIds: [],
  ...overrides,
})

const survey = (overrides: Partial<AnalyticsSurveyResponse> = {}): AnalyticsSurveyResponse => ({
  id: 'survey-1',
  participantId: 'p-1',
  answers: {},
  ...overrides,
})

describe('buildLessonAnalytics (Step 1)', () => {
  it('returns null (not 0) for every scalar metric when there is no data at all', () => {
    const analytics = buildLessonAnalytics({ lessonRunId: 'run-1', events: [], responses: [], surveys: [] })
    expect(analytics.aggregate.rationaleInformationUsageRate).toBeNull()
    expect(analytics.aggregate.judgmentChangeCount).toBeNull()
    expect(analytics.aggregate.judgmentChangeRate).toBeNull()
    expect(analytics.aggregate.comprehensionDifficultyCount).toBeNull()
    expect(analytics.aggregate.comprehensionAverage).toBeNull()
    expect(analytics.aggregate.predictionAccuracyAverage).toBeNull()
    expect(analytics.aggregate.strugglingParticipantCount).toBeNull()
    expect(analytics.aggregate.responseCount).toBe(0)
    expect(analytics.individualRows).toEqual([])
  })

  it('computes rationaleInformationUsageRate from CONFIRMED responses only, distinguishing 0% usage from no data', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [],
      responses: [
        response({ id: 'r1', participantId: 'p-1', status: 'CONFIRMED', rationaleInformationIds: ['info-a'] }),
        response({ id: 'r2', participantId: 'p-2', status: 'CONFIRMED', rationaleInformationIds: [] }),
        response({ id: 'r3', participantId: 'p-3', status: 'DRAFT', rationaleInformationIds: ['info-b'] }),
      ],
      surveys: [],
    })
    // 2 CONFIRMED responses, 1 references rationale info -> 0.5. The DRAFT response is excluded.
    expect(analytics.aggregate.confirmedResponseCount).toBe(2)
    expect(analytics.aggregate.rationaleInformationUsageRate).toBeCloseTo(0.5)
    expect(analytics.aggregate.rationaleInformationCounts).toEqual({ 'info-a': 1 })
  })

  it('never conflates "everyone answered 0%" with "nobody answered" for rationale usage', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [],
      responses: [
        response({ id: 'r1', participantId: 'p-1', status: 'CONFIRMED', rationaleInformationIds: [] }),
      ],
      surveys: [],
    })
    expect(analytics.aggregate.rationaleInformationUsageRate).toBe(0)
  })

  it('derives comprehension metrics from COMPREHENSION survey answers (1-5 scale), flagging <=2 as difficulty', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [],
      responses: [],
      surveys: [
        survey({ id: 's1', participantId: 'p-1', answers: { COMPREHENSION: 5 } }),
        survey({ id: 's2', participantId: 'p-2', answers: { COMPREHENSION: 2 } }),
        survey({ id: 's3', participantId: 'p-3', answers: {} }),
      ],
    })
    expect(analytics.aggregate.comprehensionAverage).toBeCloseTo(3.5)
    expect(analytics.aggregate.comprehensionDifficultyCount).toBe(1)
  })

  it('derives judgmentChangeCount/Rate from JUDGMENT_CHANGED survey answers, ignoring unanswered surveys', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [],
      responses: [],
      surveys: [
        survey({ id: 's1', participantId: 'p-1', answers: { JUDGMENT_CHANGED: true } }),
        survey({ id: 's2', participantId: 'p-2', answers: { JUDGMENT_CHANGED: false } }),
        survey({ id: 's3', participantId: 'p-3', answers: {} }),
      ],
    })
    expect(analytics.aggregate.judgmentChangeCount).toBe(1)
    expect(analytics.aggregate.judgmentChangeRate).toBeCloseTo(0.5)
  })

  it('derives predictionAccuracyAverage from RESULT_GAP survey answers only', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [],
      responses: [],
      surveys: [
        survey({ id: 's1', participantId: 'p-1', answers: { RESULT_GAP: 4 } }),
        survey({ id: 's2', participantId: 'p-2', answers: { RESULT_GAP: 2 } }),
      ],
    })
    expect(analytics.aggregate.predictionAccuracyAverage).toBeCloseTo(3)
  })

  it('counts strugglingParticipantCount from PROXY_CONFIRM / RECONNECT_PARTICIPANT interventions, distinct by participant', () => {
    const events: AnalyticsEvent[] = [
      {
        type: 'TEACHER_INTERVENTION_APPLIED',
        payload: { interventionType: 'PROXY_CONFIRM', impactScope: { level: 'PARTICIPANT', participantId: 'p-1' }, detail: { onBehalfOfParticipantId: 'p-1' } },
      },
      {
        type: 'TEACHER_INTERVENTION_APPLIED',
        payload: { interventionType: 'RECONNECT_PARTICIPANT', impactScope: { level: 'PARTICIPANT', participantId: 'p-1' }, detail: { participantId: 'p-1' } },
      },
      {
        type: 'TEACHER_INTERVENTION_APPLIED',
        payload: { interventionType: 'RECONNECT_PARTICIPANT', impactScope: { level: 'PARTICIPANT', participantId: 'p-2' }, detail: { participantId: 'p-2' } },
      },
      { type: 'PARTICIPANT_JOINED', payload: { participantId: 'p-3' } },
    ]
    const analytics = buildLessonAnalytics({ lessonRunId: 'run-1', events, responses: [], surveys: [] })
    expect(analytics.aggregate.strugglingParticipantCount).toBe(2)
  })

  it('reports strugglingParticipantCount as 0 (not null) when events exist but none indicate struggle', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [{ type: 'PARTICIPANT_JOINED', payload: { participantId: 'p-1' } }],
      responses: [],
      surveys: [],
    })
    expect(analytics.aggregate.strugglingParticipantCount).toBe(0)
  })

  it('builds one individualRow per distinct participant across responses and surveys, marking struggling participants', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [
        {
          type: 'TEACHER_INTERVENTION_APPLIED',
          payload: { interventionType: 'PROXY_CONFIRM', impactScope: { level: 'PARTICIPANT', participantId: 'p-1' }, detail: { onBehalfOfParticipantId: 'p-1' } },
        },
      ],
      responses: [
        response({ id: 'r1', participantId: 'p-1', status: 'CONFIRMED', rationaleInformationIds: ['info-a', 'info-b'] }),
      ],
      surveys: [
        survey({ id: 's1', participantId: 'p-1', answers: { COMPREHENSION: 4, JUDGMENT_CHANGED: true, RESULT_GAP: 3 } }),
        survey({ id: 's2', participantId: 'p-2', answers: { COMPREHENSION: 1 } }),
      ],
    })
    expect(analytics.individualRows).toHaveLength(2)
    const p1 = analytics.individualRows.find((row) => row.participantId === 'p-1')
    expect(p1).toMatchObject({
      participantId: 'p-1',
      rationaleInformationCount: 2,
      judgmentChanged: true,
      comprehensionScore: 4,
      resultGapScore: 3,
      struggling: true,
    })
    const p2 = analytics.individualRows.find((row) => row.participantId === 'p-2')
    expect(p2).toMatchObject({
      participantId: 'p-2',
      rationaleInformationCount: 0,
      judgmentChanged: null,
      comprehensionScore: 1,
      resultGapScore: null,
      struggling: false,
    })
  })

  it('excludes team-scoped responses (no participantId) from individualRows without throwing', () => {
    const analytics = buildLessonAnalytics({
      lessonRunId: 'run-1',
      events: [],
      responses: [
        { id: 'r1', teamId: 'team-1', status: 'CONFIRMED', rationaleInformationIds: ['info-a'] },
      ],
      surveys: [],
    })
    expect(analytics.individualRows).toEqual([])
    // still counted in the class-wide rate even though it has no individual row
    expect(analytics.aggregate.rationaleInformationUsageRate).toBe(1)
  })
})
