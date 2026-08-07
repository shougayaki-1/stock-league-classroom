import { describe, expect, it } from 'vitest'
import { canTransitionRun, type LessonRunStatus } from './stateMachine'

describe('canTransitionRun', () => {
  it('allows the primary happy-path chain', () => {
    const chain: [LessonRunStatus, LessonRunStatus][] = [
      ['DRAFT', 'READY'],
      ['READY', 'WAITING'],
      ['WAITING', 'RUNNING'],
      ['RUNNING', 'REFLECTION'],
      ['REFLECTION', 'COMPLETED'],
    ]
    for (const [from, to] of chain) {
      expect(canTransitionRun(from, to)).toBe(true)
    }
  })

  it('allows RUNNING <-> PAUSED in both directions', () => {
    expect(canTransitionRun('RUNNING', 'PAUSED')).toBe(true)
    expect(canTransitionRun('PAUSED', 'RUNNING')).toBe(true)
  })

  it('allows RUNNING or PAUSED to move to INTERRUPTED', () => {
    expect(canTransitionRun('RUNNING', 'INTERRUPTED')).toBe(true)
    expect(canTransitionRun('PAUSED', 'INTERRUPTED')).toBe(true)
  })

  it('allows INTERRUPTED to resume via WAITING', () => {
    expect(canTransitionRun('INTERRUPTED', 'WAITING')).toBe(true)
  })

  it('allows ABORTED from any in-progress status', () => {
    const inProgress: LessonRunStatus[] = ['WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED']
    for (const status of inProgress) {
      expect(canTransitionRun(status, 'ABORTED')).toBe(true)
    }
  })

  it('rejects ABORTED from statuses that never started or already ended', () => {
    const notInProgress: LessonRunStatus[] = ['DRAFT', 'READY', 'REFLECTION', 'COMPLETED', 'ABORTED', 'ARCHIVED']
    for (const status of notInProgress) {
      expect(canTransitionRun(status, 'ABORTED')).toBe(false)
    }
  })

  it('rejects REFLECTION -> RUNNING (REFLECTION never returns to active operation)', () => {
    expect(canTransitionRun('REFLECTION', 'RUNNING')).toBe(false)
  })

  it('rejects COMPLETED -> RUNNING (COMPLETED is terminal)', () => {
    expect(canTransitionRun('COMPLETED', 'RUNNING')).toBe(false)
  })

  it('rejects self-transitions and arbitrary skips not in the table', () => {
    expect(canTransitionRun('DRAFT', 'RUNNING')).toBe(false)
    expect(canTransitionRun('READY', 'READY')).toBe(false)
    expect(canTransitionRun('COMPLETED', 'ARCHIVED')).toBe(false)
  })
})
