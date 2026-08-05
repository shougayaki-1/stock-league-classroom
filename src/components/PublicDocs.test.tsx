import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './PublicDocs'

describe('Phase A public documents', () => {
  it('does not link readers to removed lesson routes', () => {
    const { container } = render(<GuidePage />)

    expect(container.querySelector('[href="/teacher/markets"]')).not.toBeInTheDocument()
    expect(container.querySelector('[href*="/markets/"]')).not.toBeInTheDocument()
  })

  it('explains that the upcoming lesson engine is server-authoritative', () => {
    render(<AboutPage />)

    expect(screen.getByText(/新しい授業機能は準備中です/)).toBeInTheDocument()
    expect(screen.getByText(/サーバーが権威を持つ仕組み/)).toBeInTheDocument()
  })

  it('distinguishes the current public pages from the future lesson-data policy', () => {
    const { unmount } = render(<TermsPage />)
    expect(screen.getByText(/授業機能の提供開始後に適用/)).toBeInTheDocument()
    unmount()

    render(<PrivacyPage />)
    expect(screen.getByText(/現在は、生徒の授業データを取得していません/)).toBeInTheDocument()
    expect(screen.getByText(/正式な開示・訂正・削除のご請求は、問い合わせ窓口/)).toBeInTheDocument()
  })

  it('does not present retired lesson operations as a current contact flow', () => {
    render(<ContactPage />)

    expect(screen.getByText(/現在は公開ページのみを提供しています/)).toBeInTheDocument()
    expect(screen.queryByText(/市場の参加コード/)).not.toBeInTheDocument()
  })
})
