import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the landing page and its primary paths', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /株式市場を/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /授業をはじめる/i })).toHaveAttribute('href', '/teacher/markets')
    expect(screen.getByRole('link', { name: /生徒として参加/i })).toHaveAttribute('href', '/join')
  })
})
