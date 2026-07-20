import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TemplateWorkspace } from './TemplateWorkspace'

describe('TemplateWorkspace', () => {
  it('guides unauthenticated visitors to teacher login', () => {
    render(<TemplateWorkspace />)
    expect(screen.getByText(/教師用メールリンク/)).toBeInTheDocument()
  })
})
