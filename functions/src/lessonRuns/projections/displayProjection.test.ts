import { describe, expect, it } from 'vitest'
import type { LessonRunProjectionSource } from './source'
import { deriveDisplayMode, toLessonRunDisplayState } from './displayProjection'

const privateRunFixture: LessonRunProjectionSource = {
  orgId: 'org-1',
  status: 'RUNNING',
  title: '株式投資シミュレーション',
  goal: '需要と供給の関係を理解する',
  currentPhaseId: 'phase-2',
  currentPhasePublicTask: '来週の株価を予想してください',
  currentPhaseEndsAtMillis: 10_000,
  updatedAtMillis: 5_000,
  teacherGuidance: 'スマホをしまってください',
  teams: [
    {
      id: 'team-a',
      displayName: 'Aチーム',
      publicAggregateLabel: '1位',
      individualResponses: { 'student-1': { symbol: 'ACME', amount: 100 } },
      unsubmittedParticipantIds: ['student-2'],
    },
  ],
  recentNotifications: [
    { id: 'evt-1', type: 'PHASE_CHANGED', occurredAtMillis: 4_000, actorId: 'teacher-a', payload: { secret: true } },
  ],
  randomSeed: 'top-secret-seed-value',
  restoreGeneration: 3,
  future: { prices: { ACME: 999 } },
}

describe('toLessonRunDisplayState — forbidden information (Step 1, security-critical)', () => {
  it('never contains randomSeed, future, individualResponses, or unsubmittedParticipantIds', () => {
    const display = toLessonRunDisplayState(privateRunFixture, 6_000)
    const serialized = JSON.stringify(display)
    expect(serialized).not.toContain('randomSeed')
    expect(serialized).not.toContain('future')
    expect(serialized).not.toContain('individualResponses')
    expect(serialized).not.toContain('unsubmittedParticipantIds')
  })

  it('never leaks the actual secret values even under a different key name', () => {
    const display = toLessonRunDisplayState(privateRunFixture, 6_000)
    const serialized = JSON.stringify(display)
    expect(serialized).not.toContain('top-secret-seed-value')
    expect(serialized).not.toContain('ACME')
    expect(serialized).not.toContain('student-1')
    expect(serialized).not.toContain('student-2')
    expect(serialized).not.toContain('restoreGeneration')
  })

  it('carries no authorization information other than orgId', () => {
    const display = toLessonRunDisplayState(privateRunFixture, 6_000)
    expect(Object.keys(display).sort()).toEqual(
      ['goal', 'mode', 'orgId', 'teacherGuidance', 'teams', 'title', 'updatedAtMillis'].sort(),
    )
  })
})

describe('toLessonRunDisplayState — allow-listed public fields', () => {
  it('projects the public-safe fields only', () => {
    const display = toLessonRunDisplayState(privateRunFixture, 6_000)
    expect(display).toEqual({
      orgId: 'org-1',
      mode: 'LIVE',
      title: '株式投資シミュレーション',
      goal: '需要と供給の関係を理解する',
      teams: [{ teamId: 'team-a', displayName: 'Aチーム', publicAggregateLabel: '1位' }],
      teacherGuidance: 'スマホをしまってください',
      updatedAtMillis: 5_000,
    })
  })

  it('defaults goal/teacherGuidance/publicAggregateLabel to null when absent', () => {
    const display = toLessonRunDisplayState({
      ...privateRunFixture,
      goal: null,
      teacherGuidance: null,
      teams: [{ id: 'team-b', displayName: 'Bチーム', publicAggregateLabel: null }],
    }, 6_000)
    expect(display.goal).toBeNull()
    expect(display.teacherGuidance).toBeNull()
    expect(display.teams).toEqual([{ teamId: 'team-b', displayName: 'Bチーム', publicAggregateLabel: null }])
  })
})

describe('deriveDisplayMode', () => {
  it.each([
    ['DRAFT', 'START'],
    ['READY', 'START'],
    ['WAITING', 'START'],
    ['RUNNING', 'LIVE'],
    ['PAUSED', 'LIVE'],
    ['INTERRUPTED', 'LIVE'],
    ['REFLECTION', 'EXPLANATION'],
    ['COMPLETED', 'END'],
    ['ABORTED', 'END'],
    ['ARCHIVED', 'END'],
  ] as const)('maps status %s to display mode %s', (status, expected) => {
    expect(deriveDisplayMode(status)).toBe(expected)
  })

  it('defaults an unrecognized status to START (fail toward the least-informative screen)', () => {
    expect(deriveDisplayMode('SOME_UNKNOWN_STATUS')).toBe('START')
  })
})
