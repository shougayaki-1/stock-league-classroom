import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResearchDeskPage } from './ResearchDeskPage'
import type { ResearchDeskPublicView } from '@stock-league/market-public-content'

describe('ResearchDeskPage', () => {
  it('displays message when availablePanels is empty', () => {
    const publicView: ResearchDeskPublicView = {
      phaseId: 'p-intro',
      phaseType: 'INTRO',
      availablePanels: [],
      companies: [],
      informationItems: [],
      economicIndicators: [],
      updatedAtMillis: 1000,
    }

    render(<ResearchDeskPage publicView={publicView} />)
    expect(screen.getByText('現在のフェーズではリサーチデスクは利用できません。')).toBeInTheDocument()
  })

  it('renders only available tabs and allows tab switching', async () => {
    const user = userEvent.setup()
    const publicView: ResearchDeskPublicView = {
      phaseId: 'p-info',
      phaseType: 'INFORMATION',
      availablePanels: ['COMPANIES', 'NEWS', 'STATISTICS'],
      companies: [
        {
          id: 'c1',
          name: 'Tech Alpha',
          symbol: '1001',
          industry: 'IT',
          description: 'Tech firm',
          productsAndServices: [],
          sizeClass: 'LARGE',
          riskFactors: [],
        },
      ],
      informationItems: [
        {
          id: 'n1',
          category: 'OFFICIAL_NEWS',
          source: 'Market Wire',
          publishedAtMillis: 1000,
          natureType: 'FACT',
          confidenceLevel: 'HIGH',
          targetCompanyIds: [],
          body: 'Breaking market news',
        },
      ],
      economicIndicators: [],
      updatedAtMillis: 1000,
    }

    render(<ResearchDeskPage publicView={publicView} />)

    // Tabs present
    expect(screen.getByRole('tab', { name: '企業情報' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'ニュース' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '統計資料' })).toBeInTheDocument()
    // Not present
    expect(screen.queryByRole('tab', { name: 'チームノート' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '注文' })).not.toBeInTheDocument()

    // Default first tab is Company
    expect(screen.getByRole('heading', { name: 'Tech Alpha' })).toBeInTheDocument()

    // Switch to News tab
    await user.click(screen.getByRole('tab', { name: 'ニュース' }))
    expect(screen.getByText('Breaking market news')).toBeInTheDocument()
  })

  it('renders all 5 tabs in MARKET phase', () => {
    const publicView: ResearchDeskPublicView = {
      phaseId: 'p-mkt',
      phaseType: 'MARKET',
      availablePanels: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES', 'ORDERS'],
      companies: [],
      informationItems: [],
      economicIndicators: [],
      updatedAtMillis: 1000,
    }

    render(<ResearchDeskPage publicView={publicView} onSubmitOrder={vi.fn()} onSaveNote={vi.fn()} />)

    expect(screen.getByRole('tab', { name: '企業情報' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'ニュース' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '統計資料' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'チームノート' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '注文' })).toBeInTheDocument()
  })

  it('does not echo an unknown panel id', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const publicView: ResearchDeskPublicView = {
      phaseId: 'p-runtime',
      phaseType: 'MARKET',
      availablePanels: [raw as never],
      companies: [],
      informationItems: [],
      economicIndicators: [],
      updatedAtMillis: 1000,
    }

    render(<ResearchDeskPage publicView={publicView} />)

    expect(screen.getByRole('tab', { name: '機能名を確認できません' })).toBeInTheDocument()
    expect(screen.getByText('この機能は現在利用できません。')).toBeInTheDocument()
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
  })
})
