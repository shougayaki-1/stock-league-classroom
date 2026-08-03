import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HostStatusPanel } from './HostStatusPanel'

describe('HostStatusPanel', () => {
  const props = {
    nowMillis: 90_000,
    prices: [{ stockId: 'acme', name: 'アクメ', symbol: 'ACME', price: 512, basePrice: 500 }],
    lastTickAtMillis: 89_000,
  }

  it('shows each price with its change against the starting price', () => {
    render(<HostStatusPanel {...props} />)
    expect(screen.getByText('512')).toBeInTheDocument()
    expect(screen.getByText('+2.4%')).toBeInTheDocument()
  })

  it('shows no warning when not hosting yet, regardless of elapsed time', () => {
    render(<HostStatusPanel {...props} lastTickAtMillis={undefined} hostingSinceMillis={undefined} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no warning while hosting and freshly ticked', () => {
    render(<HostStatusPanel {...props} hostingSinceMillis={0} lastTickAtMillis={89_000} nowMillis={90_000} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns with the reconnect message when a previously succeeding tick goes stale', () => {
    render(<HostStatusPanel {...props} hostingSinceMillis={0} lastTickAtMillis={60_000} nowMillis={90_000} />)
    expect(screen.getByRole('alert')).toHaveTextContent('価格が30秒間更新されていません。ホスト権限が失効しているか、通信が切れています。')
  })

  it('warns with the never-started message when hosting has begun but no tick has ever succeeded', () => {
    render(<HostStatusPanel {...props} hostingSinceMillis={0} lastTickAtMillis={undefined} nowMillis={15_000} />)
    expect(screen.getByRole('alert')).toHaveTextContent('ホスト取得から15秒経っても価格が一度も更新されていません。権限が不足しているか、別の端末がホストになっている可能性があります。')
  })
})
