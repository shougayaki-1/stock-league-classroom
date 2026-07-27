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

  it.each([
    ['/about', /サービス概要/],
    ['/guide', /教師向け操作マニュアル/],
    ['/terms', /利用規約/],
    ['/privacy', /プライバシーポリシー/],
    ['/contact', /お問い合わせ/],
  ])('serves the public document at %s without Firebase', (path, heading) => {
    window.history.pushState({}, '', path)
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('states on every public document that the market is a simulation', () => {
    window.history.pushState({}, '', '/privacy')
    render(<App />)
    // Minors' data handling is the reason these pages exist; the claim must be explicit.
    expect(screen.getByText(/生徒の個人情報は取得しない設計です/)).toBeInTheDocument()
    expect(screen.getByText(/自動削除の仕組みは実装されていません/)).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})
