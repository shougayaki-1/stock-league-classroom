import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JoinMarket } from './JoinMarket'

describe('JoinMarket', () => {
  it('参加コードと表示名を入力して参加ボタンでonJoinが呼ばれる', async () => {
    const onJoin = vi.fn()
    render(<JoinMarket onJoin={onJoin} joinResult={null} />)
    await userEvent.type(screen.getByLabelText(/参加コード/), 'ABC123')
    await userEvent.type(screen.getByLabelText(/表示名/), 'たろう')
    await userEvent.click(screen.getByRole('button', { name: /参加する/ }))
    expect(onJoin).toHaveBeenCalledWith('ABC123', 'たろう')
  })

  it('定員超過の場合はエラーメッセージを表示する', () => {
    render(<JoinMarket onJoin={vi.fn()} joinResult={{ accepted: false, reason: 'CAPACITY_FULL' }} />)
    expect(screen.getByText(/定員に達しています/)).toBeInTheDocument()
  })

  it('参加受付終了の場合は別のメッセージを表示する', () => {
    render(<JoinMarket onJoin={vi.fn()} joinResult={{ accepted: false, reason: 'JOIN_CLOSED' }} />)
    expect(screen.getByText(/参加受付を終了しています/)).toBeInTheDocument()
  })
})
