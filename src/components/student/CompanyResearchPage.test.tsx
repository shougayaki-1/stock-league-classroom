import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompanyResearchPage } from './CompanyResearchPage'
import type { CompanyPublicView } from '@stock-league/market-public-content'

describe('CompanyResearchPage', () => {
  const companies: CompanyPublicView[] = [
    {
      id: 'comp-1',
      name: 'Alpha Tech',
      symbol: '1001',
      industry: 'Technology',
      sizeClass: 'LARGE',
      description: 'A leading tech firm',
      productsAndServices: ['Cloud Hosting', 'AI Software'],
      riskFactors: ['Market competition', 'Currency risk'],
      domesticRevenueRatio: 0.7,
      overseasRevenueRatio: 0.3,
      growthProfile: 'GROWTH',
      financialStrength: 'STRONG',
      costDrivers: ['Data centers'],
    },
    {
      id: 'comp-2',
      name: 'Beta Motors',
      symbol: '1002',
      industry: 'Automotive',
      sizeClass: 'MEDIUM',
      description: 'EV manufacturer',
      productsAndServices: ['Electric Vehicles'],
      riskFactors: ['Battery supply shortage'],
    },
  ]

  it('renders empty state when no companies are available', () => {
    render(<CompanyResearchPage companies={[]} />)
    expect(screen.getByText('閲覧可能な企業情報はありません。')).toBeInTheDocument()
  })

  it('renders company list and details of the selected company', async () => {
    const user = userEvent.setup()
    render(<CompanyResearchPage companies={companies} />)

    expect(screen.getByRole('heading', { name: 'Alpha Tech' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beta Motors/i })).toBeInTheDocument()
    expect(screen.getByText('A leading tech firm')).toBeInTheDocument()
    expect(screen.getByText('Cloud Hosting')).toBeInTheDocument()
    expect(screen.getByText('国内 70% / 海外 30%')).toBeInTheDocument()
    expect(screen.getByText('STRONG')).toBeInTheDocument()

    // Switch to Beta Motors
    await user.click(screen.getByRole('button', { name: /Beta Motors/i }))
    expect(screen.getByText('EV manufacturer')).toBeInTheDocument()
    expect(screen.getByText('Electric Vehicles')).toBeInTheDocument()
    expect(screen.getByText('Battery supply shortage')).toBeInTheDocument()
  })
})
