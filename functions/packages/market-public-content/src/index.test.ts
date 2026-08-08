import { describe, expect, it } from 'vitest'
import type { CompanyPublicView, InformationPublicView } from './index'

describe('CompanyPublicView', () => {
  it('has no field that could carry a hidden coefficient', () => {
    const view: CompanyPublicView = {
      id: 'acme', name: 'アクメ商事', symbol: 'ACME', industry: '小売',
      description: '架空の総合小売企業', productsAndServices: ['日用品', 'EC'],
      sizeClass: 'MEDIUM', riskFactors: ['為替変動'],
    }
    // Compile-time guarantee: this object literal must satisfy the type
    // with ONLY these fields. If someone adds `impactSensitivities` to
    // CompanyPublicView, this test still passes but Task 1's review must
    // reject it — see the architecture note in the file header comment.
    expect(Object.keys(view)).not.toContain('impactSensitivities')
    expect(Object.keys(view)).not.toContain('minimumPriceGuard')
  })
})

describe('InformationPublicView', () => {
  it('carries only the student-facing body, never InformationImpact', () => {
    const view: InformationPublicView = {
      id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表',
      publishedAtMillis: 1000, natureType: 'FACT', confidenceLevel: 'HIGH',
      targetCompanyIds: ['acme'], body: '政府が新しい規制を発表した。',
    }
    expect(Object.keys(view)).not.toContain('baseDirection')
    expect(Object.keys(view)).not.toContain('strength')
  })
})
