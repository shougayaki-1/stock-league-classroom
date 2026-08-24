import { describe, expect, it } from 'vitest'
import {
  formatCurrentPhaseLabel,
  formatLessonDisplayMode,
  formatLessonRunRole,
  formatLessonRunStatus,
  formatParticipantStatus,
} from './lessonLabels'

describe('lesson presentation labels', () => {
  it('maps lesson runtime values to product language', () => {
    expect(formatLessonRunStatus('DRAFT')).toBe('下書き')
    expect(formatLessonRunStatus('WAITING')).toBe('参加待ち')
    expect(formatLessonRunStatus('RUNNING')).toBe('授業中')
    expect(formatLessonRunStatus('REFLECTION')).toBe('振り返り')
    expect(formatLessonRunStatus('COMPLETED')).toBe('終了')
    expect(formatLessonDisplayMode('LIVE')).toBe('授業中の画面')
    expect(formatLessonRunRole('PRIMARY')).toBe('主担当')
    expect(formatParticipantStatus('MIGRATING_DEVICE')).toBe('端末移行中')
  })

  it('never echoes unknown runtime tokens', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'

    expect(formatLessonRunStatus(raw)).toBe('授業状態を確認できません')
    expect(formatLessonDisplayMode(raw)).toBe('教室表示の状態を確認できません')
    expect(formatLessonRunRole(raw)).toBe('担当権限を確認できません')
    expect(formatParticipantStatus(raw)).toBe('参加状態を確認できません')
    expect(formatLessonRunStatus(raw)).not.toContain(raw)
  })

  it('uses authored phase text but never falls back to a phase id or raw status', () => {
    expect(formatCurrentPhaseLabel('  取引  ', 'RUNNING')).toBe('取引')
    expect(formatCurrentPhaseLabel(null, 'DRAFT')).toBe('未開始')
    expect(formatCurrentPhaseLabel(undefined, 'READY')).toBe('未開始')
    expect(formatCurrentPhaseLabel('', 'WAITING')).toBe('未開始')
    expect(formatCurrentPhaseLabel(null, 'RUNNING')).toBe('フェーズ名を確認できません')
    expect(formatCurrentPhaseLabel(null, 'phase-market-opaque')).toBe('フェーズ名を確認できません')
  })
})
