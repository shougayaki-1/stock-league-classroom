import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeamNotesPage } from './TeamNotesPage'

describe('TeamNotesPage', () => {
  it('renders initial note text and allows explicit saving', async () => {
    const user = userEvent.setup()
    const onSaveNote = vi.fn().mockResolvedValue(undefined)

    render(
      <TeamNotesPage
        note={{ text: 'チーム初期メモ', revision: 1, updatedAtMillis: 1000 }}
        onSaveNote={onSaveNote}
      />,
    )

    const textarea = screen.getByLabelText('チームノート')
    expect(textarea).toHaveValue('チーム初期メモ')

    await user.type(textarea, ' 追加考察')
    const saveButton = screen.getByRole('button', { name: '保存する' })
    await user.click(saveButton)

    expect(onSaveNote).toHaveBeenCalledWith('チーム初期メモ 追加考察', 1)
  })

  it('displays error alert and preserves local text on save failure or revision conflict', async () => {
    const user = userEvent.setup()
    const onSaveNote = vi.fn().mockRejectedValue(new Error('Revision mismatch'))

    render(
      <TeamNotesPage
        note={{ text: 'Initial', revision: 1, updatedAtMillis: 1000 }}
        onSaveNote={onSaveNote}
      />,
    )

    const textarea = screen.getByLabelText('チームノート')
    await user.clear(textarea)
    await user.type(textarea, 'My new text')
    await user.click(screen.getByRole('button', { name: '保存する' }))

    expect(screen.getByText(/他のメンバーがノートを更新したか/)).toBeInTheDocument()
    expect(textarea).toHaveValue('My new text')
  })

  it('disables save button when disabled prop is true or text is empty', () => {
    render(<TeamNotesPage disabled note={null} onSaveNote={vi.fn()} />)
    expect(screen.getByRole('button', { name: '保存する' })).toBeDisabled()
  })
})
