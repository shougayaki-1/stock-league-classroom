import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPage, GuidePage } from './PublicDocs'

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
})
