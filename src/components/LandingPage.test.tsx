import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LandingPage } from './LandingPage'

const renderLandingPage = () => render(<BrowserRouter><LandingPage /></BrowserRouter>)

describe('LandingPage', () => {
  it('lets a teacher judge classroom fit from verified facts without implementation jargon', () => {
    renderLandingPage()

    expect(screen.getByRole('heading', { level: 1, name: /社会科・家庭科/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '導入前に、まず知っておきたいこと' })).toBeInTheDocument()
    expect(screen.getByText(/社会科・公共・政治経済/)).toBeInTheDocument()
    expect(screen.getByText(/家庭科・家庭基礎・家庭総合/)).toBeInTheDocument()
    expect(screen.getByText(/実際のお金は使いません/)).toBeInTheDocument()
    expect(screen.getByText(/架空の会社/)).toBeInTheDocument()
    expect(screen.getByText(/授業機能は準備中/)).toBeInTheDocument()

    expect(screen.queryByText(/サーバーが進行を守る/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Firestore|Realtime Database|RTDB|Cloud Functions/)).not.toBeInTheDocument()
  })

  it('shows what students do, what teachers do, and the main school-use reassurances', () => {
    renderLandingPage()

    expect(screen.getByRole('heading', { name: 'どんな授業ができる？' })).toBeInTheDocument()
    expect(screen.getByText(/情報やニュースを読む/)).toBeInTheDocument()
    expect(screen.getByText(/収入・支出・住宅・保険・資産形成/)).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '先生は何をすればいい？' })).toBeInTheDocument()
    expect(screen.getByText('授業を選ぶ・つくる')).toBeInTheDocument()
    expect(screen.getByText('生徒に参加方法を案内する')).toBeInTheDocument()
    expect(screen.getByText('授業を開始して進行する')).toBeInTheDocument()
    expect(screen.getByText('結果をクラスで振り返る')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '学校で使ううえで気になること' })).toBeInTheDocument()
    expect(screen.getByText(/実在企業の株価を扱う/)).toBeInTheDocument()
    expect(screen.getByText(/表示名には本名を使わない/)).toBeInTheDocument()
    expect(screen.getByText(/先生の1台の端末だけに依存させない/)).toBeInTheDocument()
  })

  it('keeps the public guidance and policy routes reachable', () => {
    renderLandingPage()

    expect(screen.getAllByRole('link', { name: /サービス概要|詳しい利用条件/ }).some((link) => link.getAttribute('href') === '/about')).toBe(true)
    expect(screen.getAllByRole('link', { name: /操作マニュアル|教師向け案内|使い方/ }).some((link) => link.getAttribute('href') === '/guide')).toBe(true)
    expect(screen.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: /問い合わせ/ })).toHaveAttribute('href', '/contact')
  })
})
