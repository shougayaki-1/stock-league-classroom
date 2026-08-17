import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherHomePage } from './TeacherHomePage'

describe('TeacherHomePage', () => {
  it('navigates to templates and marketplace when the respective buttons are clicked', () => {
    const onOpenTemplates = vi.fn()
    const onOpenMarketplace = vi.fn()
    render(<TeacherHomePage onOpenTemplates={onOpenTemplates} onOpenMarketplace={onOpenMarketplace} />)
    fireEvent.click(screen.getByRole('button', { name: '教材を管理する' }))
    fireEvent.click(screen.getByRole('button', { name: 'コミュニティ教材を見る' }))
    expect(onOpenTemplates).toHaveBeenCalled()
    expect(onOpenMarketplace).toHaveBeenCalled()
  })

  it('renders a heading identifying the teacher home', () => {
    render(<TeacherHomePage onOpenTemplates={vi.fn()} onOpenMarketplace={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '教師ホーム' })).toBeInTheDocument()
  })
})
