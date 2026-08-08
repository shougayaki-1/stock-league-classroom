import { describe, expect, it } from 'vitest'
import { exportAnalyticsCsv } from './exportAnalyticsCsv'
import type { LessonAnalytics } from './buildAnalytics'

const baseAnalytics = (rows: LessonAnalytics['individualRows']): LessonAnalytics => ({
  lessonRunId: 'run-1',
  aggregate: {
    responseCount: 0, confirmedResponseCount: 0, surveyRespondentCount: 0,
    rationaleInformationUsageRate: null, rationaleInformationCounts: {},
    judgmentChangeCount: null, judgmentChangeRate: null,
    comprehensionDifficultyCount: null, comprehensionAverage: null,
    predictionAccuracyAverage: null, strugglingParticipantCount: null,
  },
  individualRows: rows,
})

describe('exportAnalyticsCsv (Step 3)', () => {
  it('prefixes the UTF-8 BOM to the output', () => {
    const csv = exportAnalyticsCsv(baseAnalytics([]), { showRealNames: false })
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
  })

  it('always emits the same fixed column order regardless of row content', () => {
    const csv = exportAnalyticsCsv(baseAnalytics([]), { showRealNames: false })
    const header = csv.replace('﻿', '').split('\r\n')[0]
    expect(header).toBe('participantId,displayName,teamId,rationaleInformationCount,judgmentChanged,comprehensionScore,resultGapScore,struggling')
  })

  it('anonymizes displayName by default (showRealNames: false), never leaking a real name', () => {
    const csv = exportAnalyticsCsv(
      baseAnalytics([{ participantId: 'p-1', rationaleInformationCount: 1, judgmentChanged: true, comprehensionScore: 4, resultGapScore: 3, struggling: false }]),
      { showRealNames: false, displayNames: { 'p-1': '山田太郎' } },
    )
    expect(csv).not.toContain('山田太郎')
    expect(csv).toContain('p-1')
  })

  it('renders the real name only when showRealNames is explicitly true', () => {
    const csv = exportAnalyticsCsv(
      baseAnalytics([{ participantId: 'p-1', rationaleInformationCount: 1, judgmentChanged: true, comprehensionScore: 4, resultGapScore: 3, struggling: false }]),
      { showRealNames: true, displayNames: { 'p-1': '山田太郎' } },
    )
    expect(csv).toContain('山田太郎')
  })

  it('renders null metrics as an empty cell, not the string "null"', () => {
    const csv = exportAnalyticsCsv(
      baseAnalytics([{ participantId: 'p-1', rationaleInformationCount: 0, judgmentChanged: null, comprehensionScore: null, resultGapScore: null, struggling: false }]),
      { showRealNames: false },
    )
    expect(csv).not.toContain('null')
    const dataLine = csv.replace('﻿', '').split('\r\n')[1]
    expect(dataLine).toBe('p-1,p-1,,0,,,,false')
  })

  for (const dangerous of ['=SUM(A1:A9)', '+1+1', '-1+1', '@SUM(1,2)', '\ttabbed', '\rcr']) {
    it(`neutralizes a CSV-injection cell starting with ${JSON.stringify(dangerous[0])} by prefixing a single quote`, () => {
      const csv = exportAnalyticsCsv(
        baseAnalytics([{ participantId: dangerous, rationaleInformationCount: 0, judgmentChanged: null, comprehensionScore: null, resultGapScore: null, struggling: false }]),
        { showRealNames: false },
      )
      const withoutBom = csv.slice(1)
      const headerEnd = withoutBom.indexOf('\r\n')
      // The first data cell may itself be quoted (it contains a comma, quote, or newline
      // after the leading-char defense fires) — check for the defense prefix either way
      // rather than naively splitting on '\r\n'/',' which the cell's own content can contain.
      const dataStart = withoutBom.slice(headerEnd + 2)
      expect(dataStart.startsWith('"\'') || dataStart.startsWith("'")).toBe(true)
    })
  }

  it('does not prefix a cell that does not start with a dangerous character', () => {
    const csv = exportAnalyticsCsv(
      baseAnalytics([{ participantId: 'p-1', rationaleInformationCount: 0, judgmentChanged: null, comprehensionScore: null, resultGapScore: null, struggling: false }]),
      { showRealNames: false },
    )
    const dataLine = csv.replace('﻿', '').split('\r\n')[1]
    expect(dataLine.split(',')[0]).toBe('p-1')
  })

  it('quotes a cell containing a comma so the fixed column order is never shifted', () => {
    const csv = exportAnalyticsCsv(
      baseAnalytics([{ participantId: 'p-1', rationaleInformationCount: 0, judgmentChanged: null, comprehensionScore: null, resultGapScore: null, struggling: false }]),
      { showRealNames: true, displayNames: { 'p-1': '田中, 花子' } },
    )
    const dataLine = csv.replace('﻿', '').split('\r\n')[1]
    expect(dataLine).toContain('"田中, 花子"')
  })
})
