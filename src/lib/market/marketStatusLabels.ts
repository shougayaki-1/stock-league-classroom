import type { MarketStatus } from './liveMarketTypes'

/** Kept in one place so the teacher's phase band and the student's status chip never disagree. */
export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  SETUP: '準備中',
  OPEN: '取引中',
  PAUSED: '一時停止中',
  ENDING: '結果を確定中',
  ENDED: '終了',
}

export const MARKET_PHASE_ORDER: MarketStatus[] = ['SETUP', 'OPEN', 'PAUSED', 'ENDING', 'ENDED']

/** The student market page has a brief window before `meta` loads where there is no status yet. */
export const describeStudentPhase = (status: MarketStatus | undefined): string =>
  status ? MARKET_STATUS_LABEL[status] : '接続中'
