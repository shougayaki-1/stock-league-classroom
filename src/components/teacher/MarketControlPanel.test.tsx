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
  onPauseMarket: vi.fn(),
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

  it('offers to end an open market once this device holds the lease', async () => {
    const onRequestEnd = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" onRequestEnd={onRequestEnd} />)
    await userEvent.click(screen.getByRole('button', { name: '市場を終了' }))
    expect(onRequestEnd).toHaveBeenCalled()
  })

  it('offers to pause an open market', async () => {
    const onPauseMarket = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" onPauseMarket={onPauseMarket} />)
    await userEvent.click(screen.getByRole('button', { name: '市場を一時停止' }))
    expect(onPauseMarket).toHaveBeenCalled()
  })

  it('does not offer to pause once the market is already paused', () => {
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="PAUSED" />)
    expect(screen.queryByRole('button', { name: '市場を一時停止' })).not.toBeInTheDocument()
  })

  it('offers to resume a paused market', async () => {
    const onOpenMarket = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="PAUSED" onOpenMarket={onOpenMarket} />)
    await userEvent.click(screen.getByRole('button', { name: '市場を再開' }))
    expect(onOpenMarket).toHaveBeenCalled()
  })

  it('asks for confirmation before ending the market', async () => {
    const onConfirmEnd = vi.fn(), onCancelEnd = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" endingConfirm onConfirmEnd={onConfirmEnd} onCancelEnd={onCancelEnd} />)
    expect(screen.getByText(/結果を確定します/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '終了して結果を確定する' }))
    expect(onConfirmEnd).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onCancelEnd).toHaveBeenCalled()
  })

  it('can recover a legacy ended market and offer to resume it', () => {
    render(<MarketControlPanel {...baseProps} marketStatus="ENDED" />)
    expect(screen.getByRole('button', { name: 'ホストを取得する' })).toBeInTheDocument()
    expect(screen.getByText('市場は終了しています')).toBeInTheDocument()
  })

  it('can recover a market that was interrupted during finalization', async () => {
    const onOpenMarket = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="ENDING" onOpenMarket={onOpenMarket} />)
    await userEvent.click(screen.getByRole('button', { name: '市場を再開' }))
    expect(onOpenMarket).toHaveBeenCalled()
  })
})
