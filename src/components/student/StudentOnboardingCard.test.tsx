import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StudentOnboardingCard } from './StudentOnboardingCard'

describe('StudentOnboardingCard', () => {
  it('explains that the team shares cash and holdings before trading starts', () => {
    render(<StudentOnboardingCard onDismiss={vi.fn()} />)
    expect(screen.getByText(/「チーム」で共有します/)).toBeInTheDocument()
  })

  it('calls onDismiss when the student is ready to trade', async () => {
    const onDismiss = vi.fn()
    render(<StudentOnboardingCard onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: 'わかった → 取引を始める' }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
