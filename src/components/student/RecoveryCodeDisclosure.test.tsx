import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RecoveryCodeDisclosure } from './RecoveryCodeDisclosure'

describe('RecoveryCodeDisclosure', () => {
  it('hides the recovery code until the student expands it', async () => {
    render(<RecoveryCodeDisclosure code="A1B2" />)
    expect(screen.queryByText('A1B2')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '別の端末で続きから参加したいときは' }))
    expect(screen.getByText('A1B2')).toBeInTheDocument()
  })
})
