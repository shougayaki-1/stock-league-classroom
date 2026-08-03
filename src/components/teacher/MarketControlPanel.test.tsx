import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MarketControlPanel } from './MarketControlPanel'

const baseProps = {
  lease: '',
  marketStatus: 'SETUP' as const,
  endingConfirm: false,
  ending: false,
  onTakeLease: vi.fn(),
  onOpenMarket: vi.fn(),
  onRequestEnd: vi.fn(),
  onCancelEnd: vi.fn(),
  onConfirmEnd: vi.fn(),
}

describe('MarketControlPanel', () => {
  it('offers to take the lease when nobody is hosting yet', async () => {
    const onTakeLease = vi.fn()
    render(<MarketControlPanel {...baseProps} onTakeLease={onTakeLease} />)
    await userEvent.click(screen.getByRole('button', { name: 'ホストを取得する' }))
    expect(onTakeLease).toHaveBeenCalled()
  })

  it('offers to open and end the market once this device holds the lease', async () => {
    const onOpenMarket = vi.fn(), onRequestEnd = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" onOpenMarket={onOpenMarket} onRequestEnd={onRequestEnd} />)
    await userEvent.click(screen.getByRole('button', { name: '市場を開始' }))
    expect(onOpenMarket).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '市場を終了' }))
    expect(onRequestEnd).toHaveBeenCalled()
  })

  it('asks for confirmation before ending the market', async () => {
    const onConfirmEnd = vi.fn(), onCancelEnd = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" endingConfirm onConfirmEnd={onConfirmEnd} onCancelEnd={onCancelEnd} />)
    expect(screen.getByText(/結果が確定して元に戻せません/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '終了して結果を確定する' }))
    expect(onConfirmEnd).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onCancelEnd).toHaveBeenCalled()
  })

  it('does not offer to take the lease once the market has ended', () => {
    render(<MarketControlPanel {...baseProps} marketStatus="ENDED" />)
    expect(screen.queryByRole('button', { name: 'ホストを取得する' })).not.toBeInTheDocument()
    expect(screen.getByText('市場は終了しました')).toBeInTheDocument()
  })
})
