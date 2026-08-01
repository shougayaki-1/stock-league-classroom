import { collection, getDocs, type Firestore } from 'firebase/firestore'
import type { OrderResult, TeamLeaderboardEntry } from '../market/liveMarketTypes'

export interface ExportedTeamResult {
  teamId: string
  portfolio: { cash: number; holdings?: Record<string, number> }
  leaderboard: TeamLeaderboardEntry | null
}
export interface ExportedParticipantResult {
  participantId: string
  displayName?: string
  teamId: string | null
  transactions?: Record<string, OrderResult>
}

/** A leading =, +, -, @, TAB or CR makes Excel/LibreOffice read the cell as a formula; prefixing with an
 *  apostrophe forces literal text without changing the visible content. Student-typed display names and
 *  team names flow through here, so this must run before quoting on every cell in every builder. */
const RISKY_LEADING_CHAR = /^[=+\-@\t\r]/
const escapeField = (value: string) => {
  const neutralized = RISKY_LEADING_CHAR.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized
}
/** CRLF and RFC 4180 quoting: Excel is the only tool most teachers will open this in. */
export const toCsv = (rows: string[][]): string => rows.map((row) => row.map(escapeField).join(',')).join('\r\n')

export const buildTeamCsv = (teams: ExportedTeamResult[], companyNames: Record<string, string>): string => {
  const stockIds = Object.keys(companyNames)
  const header = ['順位', 'チーム名', '最終評価額', '現金', ...stockIds.map((id) => companyNames[id])]
  const rows = [...teams]
    .sort((a, b) => (a.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER) - (b.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER))
    .map((team) => [
      team.leaderboard ? String(team.leaderboard.rank) : '',
      team.leaderboard?.name ?? team.teamId,
      team.leaderboard ? String(team.leaderboard.valuation) : '',
      String(team.portfolio.cash),
      ...stockIds.map((id) => String(team.portfolio.holdings?.[id] ?? 0)),
    ])
  return toCsv([header, ...rows])
}

const formatTime = (millis: number) => new Date(millis).toLocaleString('ja-JP', { hour12: false })

export const buildTransactionCsv = (participants: ExportedParticipantResult[], companyNames: Record<string, string>): string => {
  const header = ['約定時刻', '生徒名', 'チーム', '銘柄', '売買', '注文数', '約定数', '約定価格', '約定金額']
  const rows = participants
    .flatMap((participant) => Object.values(participant.transactions ?? {}).map((transaction) => ({ participant, transaction })))
    .sort((a, b) => a.transaction.processedAtMillis - b.transaction.processedAtMillis)
    .map(({ participant, transaction }) => [
      formatTime(transaction.processedAtMillis),
      participant.displayName ?? participant.participantId,
      participant.teamId ?? '',
      companyNames[transaction.stockId] ?? transaction.stockId,
      transaction.side === 'BUY' ? '購入' : '売却',
      String(transaction.requestedQuantity),
      String(transaction.filledQuantity),
      String(transaction.price),
      String(transaction.filledQuantity * transaction.price),
    ])
  return toCsv([header, ...rows])
}

export const fetchMarketResults = async (firestore: Firestore, marketId: string) => {
  const [teamDocs, participantDocs] = await Promise.all([
    getDocs(collection(firestore, 'marketResults', marketId, 'teams')),
    getDocs(collection(firestore, 'marketResults', marketId, 'participants')),
  ])
  return {
    teams: teamDocs.docs.map((item) => item.data() as ExportedTeamResult),
    participants: participantDocs.docs.map((item) => item.data() as ExportedParticipantResult),
  }
}

/** The BOM is what makes Excel read the Japanese headers as UTF-8 rather than Shift_JIS. */
export const downloadCsv = (filename: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
