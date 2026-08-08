import type { LessonAnalytics, LessonAnalyticsIndividualRow } from './buildAnalytics'

/**
 * §Task 15 brief Step 3: exports a `LessonAnalytics`'s `individualRows` as a
 * CSV string. No existing pattern for CSV export or CSV-injection defense
 * exists anywhere in this codebase (checked before writing this) — the
 * design below follows the industry-standard OWASP CSV Injection mitigation
 * (prefixing a leading `'` to any cell that would otherwise be interpreted
 * by Excel/Google Sheets/LibreOffice as a formula), which this module
 * introduces fresh.
 *
 * Fixed column order (never reordered, even if `LessonAnalyticsIndividualRow`
 * gains fields later — a new field must be appended as a new column, not
 * inserted, so an already-saved CSV's column positions never shift):
 *   participantId, displayName, teamId, rationaleInformationCount,
 *   judgmentChanged, comprehensionScore, resultGapScore, struggling
 *
 * `displayName` (匿名/本名表示設定): defaults to anonymized — this module's
 * `options.showRealNames` must be explicitly `true`, and a `displayNames`
 * lookup explicitly supplied, before any real name is ever rendered. When
 * anonymized (the safe default per this task's "生徒個人情報保護を最優先"
 * instruction) the `participantId` itself is rendered in the `displayName`
 * column too — it is already an opaque identifier, not a real name, so
 * reusing it costs nothing in privacy while keeping the column non-empty.
 */
export interface ExportAnalyticsCsvOptions {
  /** Defaults to `false` (匿名) — real names render only when this is explicitly `true` AND `displayNames` has an entry for that participant. */
  showRealNames?: boolean
  /** participantId -> real display name. Ignored entirely when `showRealNames` is not `true`. */
  displayNames?: Record<string, string>
}

const CSV_COLUMNS = [
  'participantId', 'displayName', 'teamId', 'rationaleInformationCount',
  'judgmentChanged', 'comprehensionScore', 'resultGapScore', 'struggling',
] as const

const UTF8_BOM = '﻿'

/** Leading characters Excel/Google Sheets/LibreOffice interpret as the start of a formula or a control sequence (OWASP CSV Injection). */
const DANGEROUS_LEADING_CHARS = new Set(['=', '+', '-', '@', '\t', '\r'])

const csvCell = (raw: string): string => {
  let value = raw
  if (value.length > 0 && DANGEROUS_LEADING_CHARS.has(value[0])) {
    value = `'${value}`
  }
  const needsQuoting = value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')
  if (needsQuoting) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** `null`/`undefined` render as an empty cell — never the literal string "null", which would be indistinguishable from a genuine 0-length answer once opened in a spreadsheet. */
const cellOf = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return ''
  return csvCell(String(value))
}

const rowToCells = (
  row: LessonAnalyticsIndividualRow,
  options: ExportAnalyticsCsvOptions,
): string[] => {
  const anonymizedName = row.participantId
  const realName = options.showRealNames ? options.displayNames?.[row.participantId] : undefined
  const displayName = realName ?? anonymizedName

  return [
    cellOf(row.participantId),
    cellOf(displayName),
    cellOf(row.teamId),
    cellOf(row.rationaleInformationCount),
    cellOf(row.judgmentChanged),
    cellOf(row.comprehensionScore),
    cellOf(row.resultGapScore),
    cellOf(row.struggling),
  ]
}

export const exportAnalyticsCsv = (
  analytics: LessonAnalytics,
  options: ExportAnalyticsCsvOptions = {},
): string => {
  const lines = [
    CSV_COLUMNS.join(','),
    ...analytics.individualRows.map((row) => rowToCells(row, options).join(',')),
  ]
  return UTF8_BOM + lines.join('\r\n')
}
