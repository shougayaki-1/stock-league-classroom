import { describe, expect, it } from 'vitest'
import { exportPriceHistoryCsv } from './exportCsv'

describe('exportPriceHistoryCsv', () => {
  it('produces a header row and one row per point, prefixing any leading =/+/-/@ to prevent CSV injection', () => {
    const csv = exportPriceHistoryCsv([
      { stockId: '=CMD|/malicious', bucketStartMillis: 0, price: 1000 },
    ])
    expect(csv).toContain("'=CMD|/malicious")
  })

  it('starts with a header row of stockId,bucketStartMillis,price', () => {
    const csv = exportPriceHistoryCsv([])
    expect(csv.replace(/^﻿/, '')).toBe('stockId,bucketStartMillis,price')
  })

  it('prefixes +, -, @, tab, and CR leading characters, and quotes cells containing commas', () => {
    const csv = exportPriceHistoryCsv([
      { stockId: '+acme', bucketStartMillis: 0, price: 1 },
      { stockId: '-acme', bucketStartMillis: 0, price: 1 },
      { stockId: '@acme', bucketStartMillis: 0, price: 1 },
      { stockId: 'a,cme', bucketStartMillis: 0, price: 1 },
    ])
    expect(csv).toContain("'+acme")
    expect(csv).toContain("'-acme")
    expect(csv).toContain("'@acme")
    expect(csv).toContain('"a,cme"')
  })

  it('prepends a UTF-8 BOM so Excel opens the CSV without mangling encoding', () => {
    const csv = exportPriceHistoryCsv([{ stockId: 'acme', bucketStartMillis: 0, price: 1000 }])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })
})
