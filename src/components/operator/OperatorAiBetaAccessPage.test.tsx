import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  OperatorAiBetaAccessPage,
  type OperatorAiBetaAccessPageProps,
} from './OperatorAiBetaAccessPage'

describe('OperatorAiBetaAccessPage', () => {
  const defaultProps: OperatorAiBetaAccessPageProps = {
    items: [
      {
        teacherUid: 'teacher-1',
        email: 'teacher1@example.com',
        approvedByUid: 'operator-1',
        approvedAtMillis: 1700000000000,
      },
    ],
    loading: false,
    mutating: false,
    accessDenied: false,
    onGrant: vi.fn(),
    onRevoke: vi.fn(),
    onNavigateToReports: vi.fn(),
    onNavigateToCertifications: vi.fn(),
  }

  it('renders access denied message when accessDenied is true', () => {
    render(<OperatorAiBetaAccessPage {...defaultProps} accessDenied={true} />)
    expect(screen.getByText('この画面は運営者のみ利用できます。')).toBeInTheDocument()
    expect(screen.queryByLabelText('教師メールアドレス')).not.toBeInTheDocument()
  })

  it('requires both email and reason before enabling grant button', () => {
    render(<OperatorAiBetaAccessPage {...defaultProps} />)
    const grantButton = screen.getByRole('button', { name: '許可を付与' })
    expect(grantButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('教師メールアドレス *'), {
      target: { value: '  teacher@example.jp  ' },
    })
    expect(grantButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('許可理由 *'), {
      target: { value: '  Trial approved  ' },
    })
    expect(grantButton).toBeEnabled()
  })

  it('calls onGrant with trimmed values and resets input on submit', async () => {
    const onGrant = vi.fn().mockResolvedValue(undefined)
    render(<OperatorAiBetaAccessPage {...defaultProps} onGrant={onGrant} />)

    const emailInput = screen.getByLabelText('教師メールアドレス *')
    const reasonInput = screen.getByLabelText('許可理由 *')
    fireEvent.change(emailInput, { target: { value: '  teacher@example.jp  ' } })
    fireEvent.change(reasonInput, { target: { value: '  Trial approved  ' } })

    fireEvent.click(screen.getByRole('button', { name: '許可を付与' }))

    await waitFor(() => {
      expect(onGrant).toHaveBeenCalledWith('teacher@example.jp', 'Trial approved')
    })
    expect(emailInput).toHaveValue('')
    expect(reasonInput).toHaveValue('')
  })

  it('displays grant mutation error if onGrant rejects', async () => {
    const onGrant = vi.fn().mockRejectedValue(new Error('Target user not found'))
    render(<OperatorAiBetaAccessPage {...defaultProps} onGrant={onGrant} />)

    fireEvent.change(screen.getByLabelText('教師メールアドレス *'), {
      target: { value: 'missing@example.com' },
    })
    fireEvent.change(screen.getByLabelText('許可理由 *'), {
      target: { value: 'reason' },
    })

    fireEvent.click(screen.getByRole('button', { name: '許可を付与' }))

    expect(await screen.findByText('Target user not found')).toBeInTheDocument()
  })

  it('shows approved teachers list with email, approvedByUid, and timestamp', () => {
    render(<OperatorAiBetaAccessPage {...defaultProps} />)
    expect(screen.getByText('teacher1@example.com')).toBeInTheDocument()
    expect(screen.getByText(/UID: teacher-1/)).toBeInTheDocument()
    expect(screen.getByText(/許可者: operator-1/)).toBeInTheDocument()
  })

  it('opens confirmation dialog on revoke click and only revokes after entering reason', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    render(<OperatorAiBetaAccessPage {...defaultProps} onRevoke={onRevoke} />)

    fireEvent.click(screen.getByRole('button', { name: '許可を取り消す' }))
    expect(screen.getByText('AIベータアクセスの取り消し')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: '取消を実行' })
    expect(confirmBtn).toBeDisabled()

    fireEvent.change(screen.getByLabelText('取消理由 *'), {
      target: { value: '  Terminated access  ' },
    })
    expect(confirmBtn).toBeEnabled()

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(onRevoke).toHaveBeenCalledWith('teacher-1', 'Terminated access')
    })
  })

  it('navigates to reports and certifications', () => {
    const onNavigateToReports = vi.fn()
    const onNavigateToCertifications = vi.fn()
    render(
      <OperatorAiBetaAccessPage
        {...defaultProps}
        onNavigateToReports={onNavigateToReports}
        onNavigateToCertifications={onNavigateToCertifications}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '通報の審査へ' }))
    expect(onNavigateToReports).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '教材認定へ' }))
    expect(onNavigateToCertifications).toHaveBeenCalled()
  })
})
