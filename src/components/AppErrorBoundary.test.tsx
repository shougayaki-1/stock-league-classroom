import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary, ConfigurationError } from './AppErrorBoundary'

describe('application error states', () => {
  it('configuration error exposes a clear page heading and alert', () => {
    render(<ConfigurationError />)
    expect(screen.getByRole('heading', { name: '公開設定が完了していません' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('FirebaseまたはApp Checkの設定を管理者が確認してください。')
  })

  it('offers a real button to reload after an unhandled application error', () => {
    const Broken = () => { throw new Error('broken') }
    const originalError = console.error
    console.error = vi.fn()
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>)
    expect(screen.getByRole('button', { name: '再読み込み' })).toHaveAttribute('type', 'button')
    console.error = originalError
  })
})
