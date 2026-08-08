import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HouseholdSummaryCard } from './HouseholdSummaryCard'

describe('HouseholdSummaryCard', () => {
  it('always renders the "これは授業用の架空プロフィールです" notice (spec §13.4)', () => {
    render(<HouseholdSummaryCard householdId="case-b" cashYen={1500000} lifeStage="子育て期" roundIndex={4} visibleConcepts={['EMERGENCY_FUND']} />)
    expect(screen.getByText('これは授業用の架空プロフィールです')).toBeInTheDocument()
  })

  it('never renders a concept category absent from visibleConcepts', () => {
    render(<HouseholdSummaryCard householdId="case-b" cashYen={1500000} lifeStage="子育て期" roundIndex={4} visibleConcepts={['EMERGENCY_FUND']} />)
    expect(screen.queryByText('住宅ローン')).not.toBeInTheDocument()
  })
})
