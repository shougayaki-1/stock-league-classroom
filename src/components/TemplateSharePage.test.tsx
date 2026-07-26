import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TemplateSharePage } from './TemplateSharePage'

describe('TemplateSharePage', () => {
  it('requires a teacher session before resolving a direct share', () => {
    render(<TemplateSharePage shareId="capability" />)
    expect(screen.getByText(/Googleアカウント/)).toBeInTheDocument()
  })
})
