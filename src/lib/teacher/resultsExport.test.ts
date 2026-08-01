import { describe, expect, it } from 'vitest'
import { buildTeamCsv, buildTransactionCsv, toCsv } from './resultsExport'
import type { ExportedTeamResult } from './resultsExport'

describe('csv encoding', () => {
  it('quotes fields containing separators, quotes or newlines', () => {
    expect(toCsv([['a', 'b,c', 'd"e', 'f\ng']])).toBe('a,"b,c","d""e","f\ng"')
  })
  it('joins rows with CRLF so Excel opens them cleanly', () => {
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb')
  })
})

const teams: ExportedTeamResult[] = [
  { teamId: 'red', portfolio: { cash: 8000, holdings: { acme: 5 } }, leaderboard: { teamId: 'red', name: '赤', valuation: 8500, rank: 1 } },
  { teamId: 'blue', portfolio: { cash: 10000, holdings: {} }, leaderboard: null },
]

describe('team result csv', () => {
  it('lists rank, valuation, cash and each holding by company name', () => {
    expect(buildTeamCsv(teams, { acme: 'アクメ' })).toBe([
      '順位,チーム名,最終評価額,現金,アクメ',
      '1,赤,8500,8000,5',
      ',blue,,10000,0',
    ].join('\r\n'))
  })
})

const participants = [{
  participantId: 'u1_s', displayName: '山田', teamId: 'red',
  transactions: {
    o2: { orderId: 'o2', participantId: 'u1_s', teamId: 'red', stockId: 'acme', side: 'SELL' as const, requestedQuantity: 3, filledQuantity: 1, price: 120, processedAtMillis: 2_000 },
    o1: { orderId: 'o1', participantId: 'u1_s', teamId: 'red', stockId: 'acme', side: 'BUY' as const, requestedQuantity: 6, filledQuantity: 6, price: 100, processedAtMillis: 1_000 },
  },
}]

describe('transaction csv', () => {
  it('orders every trade by time and records both requested and filled quantities', () => {
    const rows = buildTransactionCsv(participants, { acme: 'アクメ' }).split('\r\n')
    expect(rows[0]).toBe('約定時刻,生徒名,チーム,銘柄,売買,注文数,約定数,約定価格,約定金額')
    expect(rows[1]).toContain('山田,red,アクメ,購入,6,6,100,600')
    expect(rows[2]).toContain('山田,red,アクメ,売却,3,1,120,120')
  })
})
