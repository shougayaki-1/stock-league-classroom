import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MaterialUploadPanel } from './MaterialUploadPanel'

const materials = [{ id: 'mat-1', fileName: '教科書.pdf', text: '内容', pageCount: 5 }]

describe('MaterialUploadPanel', () => {
  it('lists materials and toggles selection', () => {
    const selected = vi.fn()
    render(
      <MaterialUploadPanel
        materials={materials}
        uploading={false}
        onUpload={vi.fn()}
        selectedIds={[]}
        onSelectionChange={selected}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '教科書.pdf' }))
    expect(selected).toHaveBeenCalledWith(['mat-1'])
  })

  it('uploads the selected file and has an empty state', () => {
    const upload = vi.fn()
    render(
      <MaterialUploadPanel
        materials={[]}
        uploading={false}
        onUpload={upload}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('資料をアップロード'), {
      target: { files: [new File(['x'], 'new.pdf', { type: 'application/pdf' })] },
    })
    expect(upload).toHaveBeenCalled()
    expect(screen.getByText('まだ資料がアップロードされていません。')).toBeInTheDocument()
  })

  it('disables upload button and file input when disabled is true', () => {
    const upload = vi.fn()
    render(
      <MaterialUploadPanel
        materials={[]}
        uploading={false}
        disabled={true}
        onUpload={upload}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: /資料をアップロード/ })
    const fileInput = screen.getByLabelText('資料をアップロード')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(fileInput).toBeDisabled()

    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'new.pdf', { type: 'application/pdf' })] },
    })
    expect(upload).not.toHaveBeenCalled()
  })
})
