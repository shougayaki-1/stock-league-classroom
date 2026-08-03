import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { seedOfficialTemplates, toTimestampMillis } from './templateRepository'
import type { TemplateSpec } from './types'

const example: TemplateSpec = { title: '元テンプレート', description: '説明', startingCash: 100, teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], companies: [{ id: 'one', name: '一社', symbol: 'ONE', initialPrice: 10 }] }

describe('template repository contracts', () => {
  it('keeps a portable template shape for duplication and share snapshots', () => {
    const copy = structuredClone(example)
    copy.companies[0].name = '変更後'
    expect(example.companies[0].name).toBe('一社')
    expect(seedOfficialTemplates).toBeTypeOf('function')
  })

  it('maps Firestore timestamps to the public millisecond contract', () => {
    expect(toTimestampMillis(Timestamp.fromMillis(1234))).toBe(1234)
    expect(toTimestampMillis(5678)).toBe(5678)
    expect(() => toTimestampMillis(null)).toThrow(/timestamp/i)
  })
})
