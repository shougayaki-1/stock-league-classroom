import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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

  // Critical Fix #2 (final whole-branch review): the SELL_ASSETS shortfall
  // option had no way to name WHICH asset to sell, even though
  // onCall.ts's submitHouseholdDecisionCallable requires a non-empty
  // shortfallResolutionAssetType whenever shortfallResolutionType ===
  // 'SELL_ASSETS'.
  const shortfallOptions = [
    { type: 'REDUCE_EXPENSES', description: '支出を減らす', resolvesYen: 100000 },
    { type: 'SELL_ASSETS', description: '資産を売却する', resolvesYen: 100000 },
  ]
  const assetHoldingsYen = { DOMESTIC_STOCK: 300000, FOREIGN_BOND: 100000 }

  it('does not render an asset picker when SELL_ASSETS is not the selected shortfall resolution', () => {
    render(<HouseholdSummaryCard
      householdId="case-b" cashYen={1500000} lifeStage="子育て期" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="REDUCE_EXPENSES"
    />)
    expect(screen.queryByText('売却する資産を選んでください')).not.toBeInTheDocument()
  })

  it('reveals an asset picker (one option per currently-held asset type) once SELL_ASSETS is selected', () => {
    render(<HouseholdSummaryCard
      householdId="case-b" cashYen={1500000} lifeStage="子育て期" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="SELL_ASSETS"
    />)
    expect(screen.getByText('売却する資産を選んでください')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'DOMESTIC_STOCK' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'FOREIGN_BOND' })).toBeInTheDocument()
  })

  it('reports the chosen asset type via onShortfallResolutionAssetTypeChange', async () => {
    const user = userEvent.setup()
    const onAssetTypeChange = vi.fn()
    render(<HouseholdSummaryCard
      householdId="case-b" cashYen={1500000} lifeStage="子育て期" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="SELL_ASSETS"
      onShortfallResolutionAssetTypeChange={onAssetTypeChange}
    />)
    await user.click(screen.getByRole('radio', { name: 'FOREIGN_BOND' }))
    expect(onAssetTypeChange).toHaveBeenCalledWith('FOREIGN_BOND')
  })

  it('preselects the asset picker from shortfallResolutionAssetType', () => {
    render(<HouseholdSummaryCard
      householdId="case-b" cashYen={1500000} lifeStage="子育て期" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="SELL_ASSETS" shortfallResolutionAssetType="DOMESTIC_STOCK"
    />)
    expect(screen.getByRole('radio', { name: 'DOMESTIC_STOCK' })).toBeChecked()
  })
})
