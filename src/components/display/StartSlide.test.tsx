import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StartSlide } from './StartSlide'

describe('StartSlide', () => {
  it('shows the title, goal, generic flow/rules/operation guidance, and a QR code + join code when a joinUrl is supplied', () => {
    render(<StartSlide title="株価変動を体験しよう" goal="需給とニュースの関係を理解する" joinUrl="https://example.com/join?code=ABC123" joinCode="ABC123" />)

    expect(screen.getByRole('heading', { name: '株価変動を体験しよう' })).toBeInTheDocument()
    expect(screen.getByText('需給とニュースの関係を理解する')).toBeInTheDocument()

    // 流れ
    expect(screen.getByText(/授業の流れ/)).toBeInTheDocument()
    // ルール
    expect(screen.getByText(/ルール/)).toBeInTheDocument()
    // 操作方法
    expect(screen.getByText(/操作方法/)).toBeInTheDocument()

    // QR / 参加コード
    expect(screen.getByText('ABC123')).toBeInTheDocument()
    expect(screen.getByTitle(/参加用QRコード/)).toBeInTheDocument()
  })

  it('renders without a QR code when no joinUrl is supplied (no invented data)', () => {
    render(<StartSlide title="タイトル" goal={null} />)
    expect(screen.queryByTitle(/参加用QRコード/)).not.toBeInTheDocument()
  })

  it('omits the goal section entirely when goal is null, rather than rendering an empty/placeholder line', () => {
    render(<StartSlide title="タイトル" goal={null} />)
    expect(screen.queryByTestId('start-slide-goal')).not.toBeInTheDocument()
  })
})
