import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
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
    expect(screen.getAllByText(/授業機能はベータ公開中です/).length).toBeGreaterThan(0)

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

  it('shows a concrete preview of the lesson flow, the 8-phase timeline, and post-lesson results', () => {
    renderLandingPage()

    const previewHeading = screen.getByRole('heading', { name: '実際の授業では、こう進みます' })
    const previewSection = previewHeading.closest('section') as HTMLElement
    expect(within(previewSection).getByText(/①ニュースを読む/)).toBeInTheDocument()
    expect(within(previewSection).getByText(/クラス全体の判断で価格が動く/)).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '進行は8つのフェーズ。先生がその場で操作します' })).toBeInTheDocument()
    expect(screen.getByText('個人予想')).toBeInTheDocument()
    expect(screen.getByText('振り返り')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '生徒ごとの判断を、あとから確認できます' })).toBeInTheDocument()
    expect(screen.getByText(/CSV出力できます/)).toBeInTheDocument()

    expect(screen.getByText(/アカウント登録は不要です/)).toBeInTheDocument()
    expect(screen.getByText(/ベータ期間中は無料でお試しいただけます/)).toBeInTheDocument()
  })

  it('keeps the public guidance and policy routes reachable', () => {
    renderLandingPage()

    expect(screen.getAllByRole('link', { name: /サービス概要|詳しい利用条件/ }).some((link) => link.getAttribute('href') === '/about')).toBe(true)
    expect(screen.getAllByRole('link', { name: /操作マニュアル|教師向け案内|使い方/ }).some((link) => link.getAttribute('href') === '/guide')).toBe(true)
    expect(screen.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms')
    expect(screen.getAllByRole('link', { name: 'プライバシーポリシー' }).some((link) => link.getAttribute('href') === '/privacy')).toBe(true)
    expect(screen.getByRole('link', { name: /問い合わせ/ })).toHaveAttribute('href', '/contact')
  })

  it('always offers a student join entry point to /join', () => {
    renderLandingPage()

    expect(screen.getAllByRole('link', { name: /生徒はこちら/ }).some((link) => link.getAttribute('href') === '/join')).toBe(true)
  })

  it('shows no teacher-login button when onTeacherLogin is not provided (services not ready)', () => {
    renderLandingPage()

    expect(screen.queryByRole('button', { name: /教師としてログイン|先生はこちら/ })).not.toBeInTheDocument()
  })

  it('offers a teacher-login button that calls onTeacherLogin when provided', async () => {
    const onTeacherLogin = vi.fn()
    const user = userEvent.setup()
    render(<BrowserRouter><LandingPage onTeacherLogin={onTeacherLogin} /></BrowserRouter>)

    const loginButtons = screen.getAllByRole('button', { name: /教師としてログイン|先生はこちら/ })
    expect(loginButtons.length).toBeGreaterThan(0)
    await user.click(loginButtons[0])
    expect(onTeacherLogin).toHaveBeenCalled()
  })
})
