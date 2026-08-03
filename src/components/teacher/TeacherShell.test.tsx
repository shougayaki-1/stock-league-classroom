import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherShell } from './TeacherShell'

const renderShell = (marketId?: string) => render(
  <MemoryRouter>
    <TeacherShell active="markets" marketId={marketId}><main>内容</main></TeacherShell>
  </MemoryRouter>,
)

describe('TeacherShell market navigation', () => {
  it('disables the control room and classroom screen links until a market is selected', () => {
    renderShell()
    const controlRoom = screen.getByRole('button', { name: 'コントロールルーム' })
    expect(controlRoom).toBeDisabled()
    expect(controlRoom).toHaveAttribute('aria-describedby', 'room-navigation-help')
    expect(screen.queryByRole('link', { name: 'コントロールルーム' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '教室画面' })).toBeDisabled()
  })

  it('links to the selected market control room and classroom screen', () => {
    renderShell('market-123')
    expect(screen.getByRole('link', { name: 'コントロールルーム' })).toHaveAttribute('href', '/teacher/markets/market-123/room')
    expect(screen.getByRole('link', { name: '教室画面' })).toHaveAttribute('href', '/markets/market-123/signage')
  })

  it('no longer exposes the removed placeholder navigation items', () => {
    renderShell('market-123')
    expect(screen.queryByText('シナリオ・ニュース予約')).not.toBeInTheDocument()
    expect(screen.queryByText('MCコントロール')).not.toBeInTheDocument()
    expect(screen.queryByText('ID発行・ステータス')).not.toBeInTheDocument()
    expect(screen.queryByText('参加承認・参加者')).not.toBeInTheDocument()
    expect(screen.queryByText('情報照会端末')).not.toBeInTheDocument()
  })
})
