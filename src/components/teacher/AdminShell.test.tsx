import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AdminShell } from './AdminShell'

const renderShell = (active: 'stocks' | 'room' = 'room') => render(
  <MemoryRouter>
    <AdminShell active={active} marketId="market-123" marketTitle="1組の市場" marketStatus="OPEN"><main>内容</main></AdminShell>
  </MemoryRouter>,
)

describe('AdminShell navigation', () => {
  it('links to the stocks page, control room and classroom screen for this market', () => {
    renderShell()
    expect(screen.getByRole('link', { name: /銘柄/ })).toHaveAttribute('href', '/teacher/markets/market-123/stocks')
    expect(screen.getByRole('link', { name: /進行/ })).toHaveAttribute('href', '/teacher/markets/market-123/room')
    const signage = screen.getByRole('link', { name: /教室画面/ })
    expect(signage).toHaveAttribute('href', '/markets/market-123/signage')
    expect(signage).toHaveAttribute('target', '_blank')
  })

  it('links back to the workspace picker', () => {
    renderShell()
    expect(screen.getByRole('link', { name: '別の市場を選ぶ' })).toHaveAttribute('href', '/teacher/markets')
  })

  it('shows the market title and status', () => {
    renderShell()
    expect(screen.getByText('1組の市場')).toBeInTheDocument()
    expect(screen.getByText('取引中')).toBeInTheDocument()
  })

  it('renders the page content', () => {
    renderShell()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })
})
