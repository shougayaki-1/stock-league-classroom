import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsageDashboardPage } from './UsageDashboardPage'
import type { OrgUsageDashboard } from '../../../lib/organizations/usageDashboard'

const data: OrgUsageDashboard = {
  lessonRunsThisMonth: 3, lessonRunsTotal: 42, concurrentActive: 2, concurrentLimit: 5,
  aiDailyUsed: 4, aiDailyLimit: 10, aiMonthlyUsed: 30, aiMonthlyLimit: 100,
}

describe('UsageDashboardPage', () => {
  it('shows a loading indicator when data is not yet loaded', () => {
    render(<UsageDashboardPage data={undefined} error={undefined} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows an error message when loading failed', () => {
    render(<UsageDashboardPage data={undefined} error="failed" />)
    expect(screen.getByText('読み込みに失敗しました')).toBeInTheDocument()
  })

  it('renders lesson run counts, concurrent usage, and AI quota usage', () => {
    render(<UsageDashboardPage data={data} error={undefined} />)
    expect(screen.getByText(/今月.*3件/)).toBeInTheDocument()
    expect(screen.getByText(/累積.*42件/)).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 5/)).toBeInTheDocument()
    expect(screen.getByText(/4 \/ 10/)).toBeInTheDocument()
    expect(screen.getByText(/30 \/ 100/)).toBeInTheDocument()
  })

  it('highlights concurrent usage when at the limit', () => {
    render(<UsageDashboardPage data={{ ...data, concurrentActive: 5, concurrentLimit: 5 }} error={undefined} />)
    expect(screen.getByText('上限に達しています')).toBeInTheDocument()
  })
})
