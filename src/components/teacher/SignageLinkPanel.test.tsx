import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SignageLinkPanel } from './SignageLinkPanel'

describe('SignageLinkPanel', () => {
  it('links to the classroom screen for this market in a new tab', () => {
    render(<SignageLinkPanel marketId="market-123" />)
    const link = screen.getByRole('link', { name: '教室画面を別タブで開く' })
    expect(link).toHaveAttribute('href', '/markets/market-123/signage')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
