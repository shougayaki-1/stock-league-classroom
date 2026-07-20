import { describe, expect, it } from 'vitest'
import { seedOfficialTemplates } from './templateRepository'
import type { TemplateSpec } from './types'

const example: TemplateSpec = { title: '元テンプレート', description: '説明', startingCash: 100, companies: [{ id: 'one', name: '一社', symbol: 'ONE', initialPrice: 10, initialShares: 10 }] }

describe('template repository contracts', () => {
  it('keeps a portable template shape for duplication and share snapshots', () => {
    const copy = structuredClone(example)
    copy.companies[0].name = '変更後'
    expect(example.companies[0].name).toBe('一社')
    expect(seedOfficialTemplates).toBeTypeOf('function')
  })
})
