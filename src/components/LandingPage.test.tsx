import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrowserRouter } from 'react-router'
import { LandingPage } from './LandingPage'

const renderLandingPage = () => render(<BrowserRouter><LandingPage /></BrowserRouter>)

describe('LandingPage', () => {
  it('shows the hero headline, subtitle, and Phase A notice', () => {
    renderLandingPage()
    expect(screen.getByRole('heading', { level: 1, name: '教室に、市場をひらこう。' })).toBeInTheDocument()
    expect(screen.getByText('生徒が情報を読み、判断し、結果から学ぶ。社会科・家庭科で使える、サーバーが進行を守る授業シミュレーターです。')).toBeInTheDocument()
    expect(screen.getByText('現在は公開ページのみ提供中です。授業機能は準備を進めています。')).toBeInTheDocument()
  })

  it('offers a secondary CTA to the guide page from the hero', () => {
    renderLandingPage()
    for (const link of screen.getAllByRole('link', { name: '操作マニュアル' })) {
      expect(link).toHaveAttribute('href', '/guide')
    }
  })

  it('lists the three product principles', () => {
    renderLandingPage()
    expect(screen.getByText('今、必要な判断だけ。')).toBeInTheDocument()
    expect(screen.getByText('なぜ起きたかまで扱う。')).toBeInTheDocument()
    expect(screen.getByText('サーバーが進行を守る。')).toBeInTheDocument()
  })

  it('introduces both supported subjects', () => {
    renderLandingPage()
    expect(screen.getByRole('heading', { level: 3, name: '社会科｜市場経済シミュレーション' })).toBeInTheDocument()
    expect(screen.getByText('需要と供給、企業と産業のつながり、景気と政策。常時売買市場で、情報をもとに投資判断を積み重ねます。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '家庭科｜生活設計シミュレーション' })).toBeInTheDocument()
    expect(screen.getByText('学生から退職後まで、人生の各段階を疑似体験。1ラウンド＝5年（設定変更可）で、家計と資産形成を考えます。役割別・段階分担など、クラスの人数構成に合わせた進行形式にも対応予定。')).toBeInTheDocument()
  })
})
