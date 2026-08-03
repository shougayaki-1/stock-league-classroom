import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StudentField } from './StudentUi'

describe('StudentField', () => {
  it('keeps the label and helper outside the input outline while associating both accessibly', () => {
    render(<StudentField id="join-code" label="参加コード" value="A1B2C3" onChange={vi.fn()} helperText="先生から受け取った6文字" />)
    const input = screen.getByRole('textbox', { name: '参加コード' })
    expect(input).toHaveValue('A1B2C3')
    expect(input).toHaveAttribute('aria-describedby', 'join-code-help')
    expect(screen.getByText('先生から受け取った6文字')).toHaveAttribute('id', 'join-code-help')
    expect(document.querySelector('.MuiInputLabel-root')).not.toBeInTheDocument()
  })
})
