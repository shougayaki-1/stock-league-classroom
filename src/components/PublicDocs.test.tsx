import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './PublicDocs'

describe('Public documents (beta lesson platform)', () => {
  it('does not link readers to removed lesson routes', () => {
    const { container } = render(<GuidePage />)

    expect(container.querySelector('[href="/teacher/markets"]')).not.toBeInTheDocument()
    expect(container.querySelector('[href*="/markets/"]')).not.toBeInTheDocument()
  })

  it('explains that the lesson engine is server-authoritative and in beta', () => {
    render(<AboutPage />)

    expect(screen.getAllByText(/授業機能はベータ公開中です/).length).toBeGreaterThan(0)
    expect(screen.getByText(/サーバーが権威を持つ仕組み/)).toBeInTheDocument()
  })

  it('states that the AI draft-generation feature is not yet available', () => {
    render(<AboutPage />)

    expect(screen.getByText(/教材のたたき台をAIが生成する機能は準備中です/)).toBeInTheDocument()
  })

  it('describes both a free personal plan and a paid school plan without inventing a price', () => {
    render(<AboutPage />)

    expect(screen.getByText(/個人の教師が利用する場合は無償です/)).toBeInTheDocument()
    expect(screen.getByText(/学校・教育委員会単位でご利用いただく場合は有償プラン/)).toBeInTheDocument()
    expect(screen.queryByText(/本サービスは無償で提供しています。料金の請求や支払い情報の入力を求めることはありません。/)).not.toBeInTheDocument()
  })

  it('extends the terms to cover the now-live lesson features and paid plan billing', () => {
    render(<TermsPage />)

    expect(screen.getByText(/授業実施、生徒参加、結果閲覧、分析閲覧を含む/)).toBeInTheDocument()
    expect(screen.getByText(/決済にはStripe/)).toBeInTheDocument()
  })

  it('describes the actual data collected for teachers and students now that lesson features are live', () => {
    render(<PrivacyPage />)

    expect(screen.getByText(/匿名のFirebase UID、表示名、チーム所属、セッション情報/)).toBeInTheDocument()
    expect(screen.getByText(/振り返りアンケートの回答/)).toBeInTheDocument()
    expect(screen.getByText(/決済代行事業者Stripe/)).toBeInTheDocument()
    expect(screen.queryByText(/現在は、生徒の授業データを取得していません。/)).not.toBeInTheDocument()
  })

  it('describes the per-school configurable retention window instead of asserting a fixed period', () => {
    render(<PrivacyPage />)

    expect(screen.getByText(/30日〜10年の範囲で設定します/)).toBeInTheDocument()
  })

  it('keeps the delete/disclosure request flow pointed at the contact channel', () => {
    render(<PrivacyPage />)

    expect(screen.getByText(/正式な開示・訂正・削除のご請求は、問い合わせ窓口/)).toBeInTheDocument()
  })

  it('does not present retired lesson operations as a current contact flow', () => {
    render(<ContactPage />)

    expect(screen.queryByText(/市場の参加コード/)).not.toBeInTheDocument()
  })

  it('limits the Sentry statement to application payloads', () => {
    render(<PrivacyPage />)

    expect(screen.getByText(/event payloadへ意図的に添付しません/)).toBeInTheDocument()
    expect(screen.getByText(/接続時に外部事業者が処理する技術情報/)).toBeInTheDocument()
    expect(screen.queryByText(/IPアドレス等の個人を識別しうる情報は送信しない/)).not.toBeInTheDocument()
  })

  it('walks the teacher through the real create-material-to-see-results flow', () => {
    render(<GuidePage />)

    expect(screen.getByText(/この教材で授業を開始/)).toBeInTheDocument()
    expect(screen.getByText(/結果を生成する」ボタンが表示されます/)).toBeInTheDocument()
  })
})
