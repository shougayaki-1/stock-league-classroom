import type { AggregatedPricePoint } from './priceHistory'

/**
 * §Task 14 brief Step 5: exports aggregated price history points as a CSV
 * string. Phase A deleted the old `resultsExport.ts` (its CSV-injection
 * defense is not reused — only the technique), so this module instead
 * mirrors the design already proven in
 * `functions/src/lessonRuns/analytics/exportAnalyticsCsv.ts` (Phase B
 * Task 15): the OWASP CSV Injection mitigation of prefixing a leading `'`
 * to any cell whose first character would otherwise be interpreted by
 * Excel/Google Sheets/LibreOffice as a formula or control sequence, plus a
 * UTF-8 BOM and a fixed column order.
 *
 * Fixed column order (never reordered, even if `AggregatedPricePoint`
 * gains fields later — a new field must be appended as a new column, not
 * inserted, so an already-saved CSV's column positions never shift):
 *   stockId, bucketStartMillis, price
 */
const CSV_COLUMNS = ['stockId', 'bucketStartMillis', 'price'] as const

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

const cellOf = (value: string | number): string => csvCell(String(value))

const rowToCells = (point: AggregatedPricePoint): string[] => [
  cellOf(point.stockId),
  cellOf(point.bucketStartMillis),
  cellOf(point.price),
]

export const exportPriceHistoryCsv = (points: AggregatedPricePoint[]): string => {
  const lines = [
    CSV_COLUMNS.join(','),
    ...points.map((point) => rowToCells(point).join(',')),
  ]
  return UTF8_BOM + lines.join('\r\n')
}
