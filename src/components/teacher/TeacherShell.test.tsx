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
  it('disables market progress until a market is selected', () => {
    renderShell()
    const action = screen.getByRole('button', { name: '市場を進行' })
    expect(action).toBeDisabled()
    expect(action).toHaveAttribute('aria-describedby', 'host-navigation-help')
    expect(screen.queryByRole('link', { name: '市場を進行' })).not.toBeInTheDocument()
  })

  it('links to the selected market host console', () => {
    renderShell('market-123')
    expect(screen.getByRole('link', { name: '市場を進行' })).toHaveAttribute('href', '/teacher/markets/market-123/host')
  })
})
