import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HouseholdSummaryCard } from './HouseholdSummaryCard'

describe('HouseholdSummaryCard', () => {
  it('always renders the "これは授業用の架空プロフィールです" notice (spec §13.4)', () => {
    render(<HouseholdSummaryCard householdId="case-b" profileLabel="子育て期・配偶者・子1人" cashYen={1500000} lifeStage="CHILD_REARING" roundIndex={4} visibleConcepts={['EMERGENCY_FUND']} />)
    expect(screen.getByText('これは授業用の架空プロフィールです')).toBeInTheDocument()
  })

  it('never renders a concept category absent from visibleConcepts', () => {
    render(<HouseholdSummaryCard householdId="case-b" profileLabel="子育て期・配偶者・子1人" cashYen={1500000} lifeStage="CHILD_REARING" roundIndex={4} visibleConcepts={['EMERGENCY_FUND']} />)
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
  const assetHoldingsYen = { DOMESTIC_STOCK: 300000, FOREIGN_STOCK: 100000 }

  it('does not render an asset picker when SELL_ASSETS is not the selected shortfall resolution', () => {
    render(<HouseholdSummaryCard
      householdId="case-b" profileLabel="子育て期・配偶者・子1人" cashYen={1500000} lifeStage="CHILD_REARING" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="REDUCE_EXPENSES"
    />)
    expect(screen.queryByText('売却する資産を選んでください')).not.toBeInTheDocument()
  })

  it('reveals an asset picker (one option per currently-held asset type) once SELL_ASSETS is selected, using Japanese labels', () => {
    render(<HouseholdSummaryCard
      householdId="case-b" profileLabel="子育て期・配偶者・子1人" cashYen={1500000} lifeStage="CHILD_REARING" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="SELL_ASSETS"
    />)
    expect(screen.getByText('売却する資産を選んでください')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '国内株式' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '外国株式' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('DOMESTIC_STOCK')
    expect(document.body.textContent).not.toContain('FOREIGN_STOCK')
  })

  it('reports the chosen ORIGINAL asset-type value via onShortfallResolutionAssetTypeChange, even though the label shown was Japanese', async () => {
    const user = userEvent.setup()
    const onAssetTypeChange = vi.fn()
    render(<HouseholdSummaryCard
      householdId="case-b" profileLabel="子育て期・配偶者・子1人" cashYen={1500000} lifeStage="CHILD_REARING" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="SELL_ASSETS"
      onShortfallResolutionAssetTypeChange={onAssetTypeChange}
    />)
    await user.click(screen.getByRole('radio', { name: '国内株式' }))
    expect(onAssetTypeChange).toHaveBeenCalledWith('DOMESTIC_STOCK')
  })

  it('preselects the asset picker from shortfallResolutionAssetType', () => {
    render(<HouseholdSummaryCard
      householdId="case-b" profileLabel="子育て期・配偶者・子1人" cashYen={1500000} lifeStage="CHILD_REARING" roundIndex={4} visibleConcepts={[]}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={shortfallOptions}
      shortfallResolutionValue="SELL_ASSETS" shortfallResolutionAssetType="DOMESTIC_STOCK"
    />)
    expect(screen.getByRole('radio', { name: '国内株式' })).toBeChecked()
  })

  it('renders the human profileLabel as the sole heading and never falls back to the opaque runtime householdId', () => {
    render(<HouseholdSummaryCard
      householdId="runtime-secret-id" profileLabel="子育て期・配偶者・子1人" cashYen={1500000}
      lifeStage="CHILD_REARING" roundIndex={0} visibleConcepts={['ASSET_DIVERSIFICATION']}
      assetHoldingsYen={assetHoldingsYen} shortfallOptions={[{ type: 'SELL_ASSETS', description: '資産を売却する', resolvesYen: 100000 }]}
      shortfallResolutionValue="SELL_ASSETS"
      onShortfallResolutionAssetTypeChange={vi.fn()}
    />)
    expect(screen.getByText('子育て期・配偶者・子1人')).toBeInTheDocument()
    expect(screen.getByText('ライフステージ: 子育て期')).toBeInTheDocument()
    expect(screen.getByText('第1ラウンド')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '国内株式' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('DOMESTIC_STOCK')
    expect(document.body.textContent).not.toContain('runtime-secret-id')
  })

  it('never renders an unknown asset type as a selectable option and shows a generic fail-closed notice instead', () => {
    render(<HouseholdSummaryCard
      householdId="case-b" profileLabel="子育て期・配偶者・子1人" cashYen={1500000} lifeStage="CHILD_REARING" roundIndex={4}
      visibleConcepts={['ASSET_DIVERSIFICATION']}
      assetHoldingsYen={{ DOMESTIC_STOCK: 100000, UNKNOWN_BACKEND_ASSET: 50000 }}
    />)
    expect(screen.getByText('一部の資産種別を確認できません。')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('UNKNOWN_BACKEND_ASSET')
    expect(screen.queryByRole('radio', { name: 'UNKNOWN_BACKEND_ASSET' })).not.toBeInTheDocument()
  })
})
