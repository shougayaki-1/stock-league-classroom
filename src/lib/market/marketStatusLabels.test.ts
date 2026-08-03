import { describe, expect, it } from 'vitest'
import { describeStudentPhase, MARKET_PHASE_ORDER, MARKET_STATUS_LABEL } from './marketStatusLabels'

describe('marketStatusLabels', () => {
  it('labels every market status in Japanese', () => {
    expect(MARKET_STATUS_LABEL.SETUP).toBe('準備中')
    expect(MARKET_STATUS_LABEL.OPEN).toBe('取引中')
    expect(MARKET_STATUS_LABEL.ENDING).toBe('結果を確定中')
    expect(MARKET_STATUS_LABEL.ENDED).toBe('終了')
  })

  it('orders the phases from setup to ended', () => {
    expect(MARKET_PHASE_ORDER).toEqual(['SETUP', 'OPEN', 'ENDING', 'ENDED'])
  })

  it('falls back to a connecting label before the student has a status yet', () => {
    expect(describeStudentPhase(undefined)).toBe('接続中')
    expect(describeStudentPhase('OPEN')).toBe('取引中')
  })
})
