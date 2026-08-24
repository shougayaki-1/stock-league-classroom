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

  it('handles revision conflict by semantic code without exposing backend details', async () => {
    const user = userEvent.setup()
    const raw = 'INTERNAL_BACKEND_DETAIL'
    const onSaveNote = vi.fn().mockRejectedValue({
      code: 'functions/aborted',
      message: raw,
    })

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

    expect(screen.getByText(
      '他のメンバーが先に更新しました。最新の内容を確認してもう一度保存してください。',
    )).toBeInTheDocument()
    expect(textarea).toHaveValue('My new text')
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
    expect(screen.queryByText(/Revision mismatch/i)).not.toBeInTheDocument()
  })

  it('keeps revision internal and uses human reset copy', async () => {
    const user = userEvent.setup()
    render(
      <TeamNotesPage
        note={{ text: '最新内容', revision: 42, updatedAtMillis: 1000 }}
        onSaveNote={vi.fn()}
      />,
    )

    expect(screen.queryByText(/リビジョン/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/revision/i)).not.toBeInTheDocument()

    const textarea = screen.getByLabelText('チームノート')
    await user.type(textarea, ' 編集中')
    const reset = screen.getByRole('button', { name: '最新の内容に戻す' })
    expect(reset).toBeInTheDocument()
    await user.click(reset)
    expect(textarea).toHaveValue('最新内容')
  })

  it('uses safe generic copy for an unknown save error', async () => {
    const user = userEvent.setup()
    const raw = 'INTERNAL_BACKEND_DETAIL'
    const onSaveNote = vi.fn().mockRejectedValue(new Error(raw))

    render(
      <TeamNotesPage
        note={{ text: 'Initial', revision: 1, updatedAtMillis: 1000 }}
        onSaveNote={onSaveNote}
      />,
    )

    await user.click(screen.getByRole('button', { name: '保存する' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'ノートを保存できませんでした。もう一度お試しください。',
    )
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
  })

  it('disables save button when disabled prop is true or text is empty', () => {
    render(<TeamNotesPage disabled note={null} onSaveNote={vi.fn()} />)
    expect(screen.getByRole('button', { name: '保存する' })).toBeDisabled()
  })
})
