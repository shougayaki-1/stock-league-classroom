import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('keeps every landing-page CTA within the surviving public routes', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: '使い方' })).toHaveAttribute('href', '/guide')
    expect(screen.getByRole('link', { name: '特徴' })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('link', { name: /詳しく見る/i })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('link', { name: /サービス概要を見る/i })).toHaveAttribute('href', '/about')
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

  it('states the current Phase A privacy posture', () => {
    window.history.pushState({}, '', '/privacy')
    render(<App />)
    expect(screen.getByText(/現在は、生徒の授業データを取得していません/)).toBeInTheDocument()
    expect(screen.getByText(/保存期間と自動削除は、授業機能の提供開始前に明示/)).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('shows a not-found page for an unknown route instead of falling back to the landing page', () => {
    window.history.pushState({}, '', '/does-not-exist')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('normalizes a trailing slash before matching a public route', async () => {
    window.history.pushState({}, '', '/terms/')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /利用規約/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/terms')
    window.history.pushState({}, '', '/')
  })

  it('does not leave the removed host console route reachable', () => {
    window.history.pushState({}, '', '/teacher/markets/demo-market/host?tab=news')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})
