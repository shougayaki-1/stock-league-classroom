import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateWorkspace } from './TemplateWorkspace'

describe('TemplateWorkspace', () => {
  it('only exposes the official editor to an operator', () => {
    render(<TemplateWorkspace />)
    expect(screen.queryByText(/運営者用/)).not.toBeInTheDocument()
  })

  it('saves the selected official template when operated by an operator', () => {
    const onSaveOfficial = vi.fn().mockResolvedValue(undefined)
    render(<TemplateWorkspace isOperator onSaveOfficial={onSaveOfficial} />)
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    expect(onSaveOfficial).toHaveBeenCalledWith('school-festival', expect.objectContaining({ title: '学園祭マーケット' }))
  })
})
