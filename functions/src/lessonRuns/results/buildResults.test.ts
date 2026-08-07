import { describe, expect, it } from 'vitest'
import { buildDecisionExplanation, buildLessonResult, type DecisionExplanationEvent } from './buildResults'

describe('buildDecisionExplanation (Step 1)', () => {
  it('returns the fixed "no evidence" text for every field when there is nothing to read', () => {
    expect(buildDecisionExplanation([])).toEqual({
      whatHappened: expect.any(String),
      whyItHappened: expect.any(String),
      alternative: expect.any(String),
      nextAction: expect.any(String),
    })
    const result = buildDecisionExplanation([])
    expect(result.whatHappened).toBe('記録された根拠がありません')
    expect(result.whyItHappened).toBe('記録された根拠がありません')
    expect(result.alternative).toBe('記録された根拠がありません')
    expect(result.nextAction).toBe('記録された根拠がありません')
  })

  it('never invents a claim not backed by an event: an unrelated event type still yields the fixed text', () => {
    const events: DecisionExplanationEvent[] = [
      { type: 'PARTICIPANT_JOINED', payload: { participantId: 'p-1' }, actorType: 'STUDENT', actorId: 'p-1' },
    ]
    const result = buildDecisionExplanation(events)
    expect(result.whatHappened).toBe('記録された根拠がありません')
    expect(result.whyItHappened).toBe('記録された根拠がありません')
  })

  it('derives whatHappened from a RESPONSE_CONFIRMED event', () => {
    const events: DecisionExplanationEvent[] = [
      { type: 'RESPONSE_CONFIRMED', payload: { responseId: 'resp-1', phaseId: 'phase-1', inputId: 'input-1' }, actorType: 'STUDENT', actorId: 'p-1' },
    ]
    const result = buildDecisionExplanation(events)
    expect(result.whatHappened).toContain('resp-1')
    expect(result.whatHappened).not.toBe('記録された根拠がありません')
  })

  it('derives whyItHappened from a TEACHER_INTERVENTION_APPLIED event\'s reason, taking priority over a plain approval', () => {
    const events: DecisionExplanationEvent[] = [
      { type: 'PROPOSAL_DECIDED', payload: { responseId: 'resp-1', decision: 'APPROVE', resultingStatus: 'APPROVED' }, actorType: 'STUDENT', actorId: 'p-1' },
      { type: 'TEACHER_INTERVENTION_APPLIED', payload: { interventionType: 'CORRECT_STATE', reason: '価格データの誤りを修正' }, actorType: 'TEACHER', actorId: 't-1' },
    ]
    const result = buildDecisionExplanation(events)
    expect(result.whyItHappened).toContain('価格データの誤りを修正')
  })

  it('derives whyItHappened from an APPROVE decision when there is no teacher intervention', () => {
    const events: DecisionExplanationEvent[] = [
      { type: 'PROPOSAL_DECIDED', payload: { responseId: 'resp-1', decision: 'APPROVE', resultingStatus: 'APPROVED' }, actorType: 'STUDENT', actorId: 'p-1' },
    ]
    const result = buildDecisionExplanation(events)
    expect(result.whyItHappened).not.toBe('記録された根拠がありません')
  })

  it('derives alternative from REJECTED proposals', () => {
    const events: DecisionExplanationEvent[] = [
      { type: 'PROPOSAL_DECIDED', payload: { responseId: 'resp-2', decision: 'REJECT', resultingStatus: 'REJECTED' }, actorType: 'STUDENT', actorId: 'p-1' },
    ]
    const result = buildDecisionExplanation(events)
    expect(result.alternative).toContain('resp-2')
  })

  it('derives nextAction from the latest PHASE_CHANGED event', () => {
    const events: DecisionExplanationEvent[] = [
      { type: 'PHASE_CHANGED', payload: { previousPhaseId: 'phase-1', newPhaseId: 'phase-2', reason: null }, actorType: 'TEACHER', actorId: 't-1' },
    ]
    const result = buildDecisionExplanation(events)
    expect(result.nextAction).toContain('phase-2')
  })
})

describe('buildLessonResult (Step 3)', () => {
  it('aggregates confirmed responses with a decision explanation per response', () => {
    const result = buildLessonResult({
      id: 'result-1',
      lessonRunId: 'run-1',
      orgId: 'org-1',
      phaseId: 'phase-decision',
      generatedAt: 'now',
      responses: [
        {
          id: 'resp-1', lessonRunId: 'run-1', orgId: 'org-1', participantId: 'p-1', phaseId: 'phase-decision',
          inputId: 'input-1', value: 'BUY', status: 'CONFIRMED', revision: 2, rationaleInformationIds: [], approvals: ['p-1'],
          contextSnapshot: {}, confirmedAt: 'now',
        },
      ],
      eventsByResponseId: {
        'resp-1': [
          { type: 'RESPONSE_CONFIRMED', payload: { responseId: 'resp-1' }, actorType: 'STUDENT', actorId: 'p-1' },
        ],
      },
    })
    expect(result.id).toBe('result-1')
    expect(result.responses).toHaveLength(1)
    expect(result.responses[0].scope).toBe('participant')
    expect(result.responses[0].decisionExplanation.whatHappened).toContain('resp-1')
  })

  it('scopes a team response as "team" and carries teamId', () => {
    const result = buildLessonResult({
      id: 'result-1', lessonRunId: 'run-1', orgId: 'org-1', phaseId: 'phase-decision', generatedAt: 'now',
      responses: [
        {
          id: 'resp-2', lessonRunId: 'run-1', orgId: 'org-1', teamId: 'team-1', phaseId: 'phase-decision',
          inputId: 'input-1', value: 'SELL', status: 'CONFIRMED', revision: 1, rationaleInformationIds: [], approvals: [],
          contextSnapshot: {}, confirmedAt: 'now',
        },
      ],
      eventsByResponseId: {},
    })
    expect(result.responses[0].scope).toBe('team')
    expect(result.responses[0].teamId).toBe('team-1')
    expect(result.responses[0].decisionExplanation.whatHappened).toBe('記録された根拠がありません')
  })
})
