import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
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

  it('confirms before navigating to stocks when a guard message is set, and blocks navigation if declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <MemoryRouter initialEntries={['/teacher/markets/market-123/room']}>
        <Routes>
          <Route path="/teacher/markets/:marketId/room" element={<AdminShell active="room" marketId="market-123" stocksNavGuardMessage="市場が進行中です。移動しますか？"><main>進行画面</main></AdminShell>} />
          <Route path="/teacher/markets/:marketId/stocks" element={<main>銘柄画面</main>} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('link', { name: /銘柄/ }))
    expect(confirmSpy).toHaveBeenCalledWith('市場が進行中です。移動しますか？')
    expect(screen.getByText('進行画面')).toBeInTheDocument()
    expect(screen.queryByText('銘柄画面')).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('navigates to stocks without a confirm dialog when no guard message is set', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(
      <MemoryRouter>
        <AdminShell active="room" marketId="market-123"><main>内容</main></AdminShell>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('link', { name: /銘柄/ }))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
