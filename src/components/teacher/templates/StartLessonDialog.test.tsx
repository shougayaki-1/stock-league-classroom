import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StartLessonDialog } from './StartLessonDialog'

describe('StartLessonDialog', () => {
  it('starts a lesson with the entered participant count', () => {
    const onStart = vi.fn()
    render(<StartLessonDialog open onClose={vi.fn()} onStart={onStart} starting={false} />)
    fireEvent.change(screen.getByLabelText('想定人数'), { target: { value: '35' } })
    fireEvent.click(screen.getByRole('button', { name: '開始する' }))
    expect(onStart).toHaveBeenCalledWith(35)
  })

  it('disables the start button when participant count is out of range', () => {
    render(<StartLessonDialog open onClose={vi.fn()} onStart={vi.fn()} starting={false} />)
    fireEvent.change(screen.getByLabelText('想定人数'), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: '開始する' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('想定人数'), { target: { value: '81' } })
    expect(screen.getByRole('button', { name: '開始する' })).toBeDisabled()
  })

  it('disables the start button while starting', () => {
    render(<StartLessonDialog open onClose={vi.fn()} onStart={vi.fn()} starting />)
    expect(screen.getByRole('button', { name: '開始する' })).toBeDisabled()
  })

  it('shows the error message when provided', () => {
    render(<StartLessonDialog open onClose={vi.fn()} onStart={vi.fn()} starting={false} error="失敗しました" />)
    expect(screen.getByText('失敗しました')).toBeInTheDocument()
  })

  it('calls onClose when cancelled', () => {
    const onClose = vi.fn()
    render(<StartLessonDialog open onClose={onClose} onStart={vi.fn()} starting={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalled()
  })
})
