import { describe, expect, it } from 'vitest'
import { classifyNotification, defaultSoundEnabled, toNotificationRecord } from './notifications'

describe('classifyNotification', () => {
  it.each([
    ['LESSON_STATUS_CHANGED', 'IMPORTANT'],
    ['PHASE_CHANGED', 'IMPORTANT'],
    ['TEACHER_INTERVENTION_APPLIED', 'IMPORTANT'],
    ['PRIMARY_TEACHER_TRANSFERRED', 'IMPORTANT'],
    ['LESSON_INTERRUPTED', 'IMPORTANT'],
    ['LESSON_ABORTED', 'IMPORTANT'],
    ['CHECKPOINT_RESTORED', 'IMPORTANT'],
  ] as const)('classifies %s as IMPORTANT', (type, expected) => {
    expect(classifyNotification(type)).toBe(expected)
  })

  it.each([
    ['PARTICIPANT_JOINED', 'NORMAL'],
    ['PARTICIPANT_RECOVERED', 'NORMAL'],
    ['RESPONSE_CONFIRMED', 'NORMAL'],
    ['PROPOSAL_SUBMITTED', 'NORMAL'],
    ['PROPOSAL_DECIDED', 'NORMAL'],
    ['TEAM_MEMBER_ASSIGNED', 'NORMAL'],
    ['TEAM_REPRESENTATIVE_CHANGED', 'NORMAL'],
  ] as const)('classifies %s as NORMAL', (type, expected) => {
    expect(classifyNotification(type)).toBe(expected)
  })

  it.each([
    ['RESPONSE_SAVED'],
  ] as const)('classifies high-frequency %s as REFERENCE', (type) => {
    expect(classifyNotification(type)).toBe('REFERENCE')
  })

  it('defaults an unknown/future event type to REFERENCE (extensibility for Phase C aggregatable events)', () => {
    expect(classifyNotification('PRICE_TICK_UPDATED')).toBe('REFERENCE')
    expect(classifyNotification('SOME_FUTURE_EVENT_TYPE')).toBe('REFERENCE')
  })
})

describe('defaultSoundEnabled', () => {
  it('defaults sound to true only for IMPORTANT', () => {
    expect(defaultSoundEnabled('IMPORTANT')).toBe(true)
    expect(defaultSoundEnabled('NORMAL')).toBe(false)
    expect(defaultSoundEnabled('REFERENCE')).toBe(false)
  })
})

describe('toNotificationRecord', () => {
  it('builds an allow-listed notification history record from a lesson event, classifying its severity', () => {
    const record = toNotificationRecord({
      eventId: 'run-1_3', type: 'PHASE_CHANGED', sequence: 3, serverOccurredAtMillis: 1_000,
      actorId: 'teacher-a', payload: { fromPhaseId: 'p1', toPhaseId: 'p2' },
    })
    expect(record).toEqual({
      eventId: 'run-1_3', type: 'PHASE_CHANGED', sequence: 3, occurredAtMillis: 1_000,
      severity: 'IMPORTANT', soundEnabled: true,
    })
  })

  it('never carries actorId or payload through into the notification record', () => {
    const record = toNotificationRecord({
      eventId: 'run-1_4', type: 'RESPONSE_SAVED', sequence: 4, serverOccurredAtMillis: 2_000,
      actorId: 'student-secret-uid', payload: { symbol: 'SECRET_COMPANY', amount: 12345 },
    })
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain('actorId')
    expect(serialized).not.toContain('student-secret-uid')
    expect(serialized).not.toContain('payload')
    expect(serialized).not.toContain('SECRET_COMPANY')
  })
})
