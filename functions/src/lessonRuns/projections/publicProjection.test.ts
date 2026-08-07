import { describe, expect, it } from 'vitest'
import type { LessonRunProjectionSource } from './source'
import { toLessonRunPublicState } from './publicProjection'

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
    { id: 'evt-2', type: 'RESPONSE_SAVED', occurredAtMillis: 4_500, actorId: 'student-1', payload: { amount: 42 } },
  ],
  randomSeed: 'top-secret-seed-value',
  restoreGeneration: 3,
  future: { prices: { ACME: 999 } },
}

describe('toLessonRunPublicState — forbidden information (Step 1, security-critical)', () => {
  it('never contains randomSeed, future, individualResponses, or unsubmittedParticipantIds', () => {
    const publicState = toLessonRunPublicState(privateRunFixture, 6_000)
    const serialized = JSON.stringify(publicState)
    expect(serialized).not.toContain('randomSeed')
    expect(serialized).not.toContain('future')
    expect(serialized).not.toContain('individualResponses')
    expect(serialized).not.toContain('unsubmittedParticipantIds')
  })

  it('never leaks the actual secret values, actor identities, or raw event payloads', () => {
    const publicState = toLessonRunPublicState(privateRunFixture, 6_000)
    const serialized = JSON.stringify(publicState)
    expect(serialized).not.toContain('top-secret-seed-value')
    expect(serialized).not.toContain('ACME')
    expect(serialized).not.toContain('student-1')
    expect(serialized).not.toContain('teacher-a')
    expect(serialized).not.toContain('restoreGeneration')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('amount')
  })
})

describe('toLessonRunPublicState — allow-listed public fields', () => {
  it('projects status/phase/remaining-time/publicTask/notifications only', () => {
    const publicState = toLessonRunPublicState(privateRunFixture, 6_000)
    expect(publicState).toEqual({
      status: 'RUNNING',
      currentPhaseId: 'phase-2',
      updatedAtMillis: 5_000,
      orgId: 'org-1',
      remainingPhaseSeconds: 4,
      publicTask: '来週の株価を予想してください',
      notifications: [
        { id: 'evt-1', type: 'PHASE_CHANGED', severity: 'IMPORTANT', occurredAtMillis: 4_000 },
        { id: 'evt-2', type: 'RESPONSE_SAVED', severity: 'REFERENCE', occurredAtMillis: 4_500 },
      ],
    })
  })

  it('clamps remainingPhaseSeconds to 0 instead of going negative once the phase end has passed', () => {
    const publicState = toLessonRunPublicState(privateRunFixture, 999_999)
    expect(publicState.remainingPhaseSeconds).toBe(0)
  })

  it('reports remainingPhaseSeconds as null when no phase timer is active', () => {
    const publicState = toLessonRunPublicState({ ...privateRunFixture, currentPhaseEndsAtMillis: null }, 6_000)
    expect(publicState.remainingPhaseSeconds).toBeNull()
  })

  it('reports publicTask as null when the current phase has none', () => {
    const publicState = toLessonRunPublicState({ ...privateRunFixture, currentPhasePublicTask: null }, 6_000)
    expect(publicState.publicTask).toBeNull()
  })
})
