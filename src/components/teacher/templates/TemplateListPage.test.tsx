import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateListPage } from './TemplateListPage'

describe('TemplateListPage', () => {
  it('opens existing templates and creates new ones', () => {
    const open = vi.fn(), create = vi.fn()
    render(<TemplateListPage loading={false} templates={[{ id: 'a', draft: { title: '既存教材' } } as never]} onOpen={open} onCreateNew={create} />)
    fireEvent.click(screen.getByText('既存教材'))
    fireEvent.click(screen.getByRole('button', { name: '新規作成' }))
    expect(open).toHaveBeenCalledWith('a')
    expect(create).toHaveBeenCalled()
  })

  it('shows a pending-approval badge when approvalStatus is PENDING', () => {
    render(<TemplateListPage loading={false} templates={[{ id: 'a', draft: { title: '既存教材' }, status: 'READY', approvalStatus: 'PENDING' } as never]} onOpen={vi.fn()} onCreateNew={vi.fn()} />)
    expect(screen.getByText(/・承認待ち/)).toBeInTheDocument()
  })
})
