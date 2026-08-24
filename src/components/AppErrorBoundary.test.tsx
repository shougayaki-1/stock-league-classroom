import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary, ConfigurationError } from './AppErrorBoundary'

describe('application error states', () => {
  it('configuration error uses generic user-facing copy with no implementation terminology', () => {
    render(<ConfigurationError />)

    expect(screen.getByRole('heading', { name: '利用を開始できません' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('必要な設定を確認できませんでした。管理者に連絡してください。')
    expect(screen.queryByText(/Firebase/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/App Check/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/CONFIGURATION ERROR/i)).not.toBeInTheDocument()
  })

  it('offers a reload action after an unhandled error without exposing technical labels', () => {
    const Broken = () => { throw new Error('backend-secret-message') }
    const originalError = console.error
    console.error = vi.fn()

    try {
      render(<AppErrorBoundary><Broken /></AppErrorBoundary>)
      expect(screen.getByRole('heading', { name: 'アプリを開始できませんでした' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '再読み込み' })).toHaveAttribute('type', 'button')
      expect(screen.queryByText(/CONNECTION ERROR/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/backend-secret-message/i)).not.toBeInTheDocument()
    } finally {
      console.error = originalError
    }
  })
})
