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
})
