import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'
import { HouseholdRoundControlPanel } from './HouseholdRoundControlPanel'
import { processRound } from '../../lib/homeEconomics/processRound'

vi.mock('../../lib/homeEconomics/processRound', () => ({ processRound: vi.fn() }))

describe('HouseholdRoundControlPanel', () => {
  const functions = {} as Functions

  it('renders the household id and a settle-round action', () => {
    render(<HouseholdRoundControlPanel lessonRunId="run-1" householdId="case-b" functions={functions} />)
    expect(screen.getByText('case-b')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ラウンドを決算する' })).toBeInTheDocument()
  })

  it('invokes the processRound Callable wrapper with lessonRunId/householdId when clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(processRound).mockResolvedValue({
      newHouseholdState: { householdId: 'case-b' },
      occurredEventIds: [], incomeYen: 0, expensesYen: 0, netCashFlowYen: 0, shortfallYen: 0, insuranceBenefitsYen: 0,
    } as never)
    render(<HouseholdRoundControlPanel lessonRunId="run-1" householdId="case-b" functions={functions} />)

    await user.click(screen.getByRole('button', { name: 'ラウンドを決算する' }))

    expect(processRound).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1', householdId: 'case-b' })
    await waitFor(() => expect(screen.getByText('決算が完了しました。')).toBeInTheDocument())
  })

  it('forwards forceSettle when the caller opts in', async () => {
    const user = userEvent.setup()
    vi.mocked(processRound).mockResolvedValue({} as never)
    render(<HouseholdRoundControlPanel lessonRunId="run-1" householdId="case-b" functions={functions} forceSettle />)

    await user.click(screen.getByRole('button', { name: 'ラウンドを決算する' }))

    expect(processRound).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1', householdId: 'case-b', forceSettle: true })
  })

  it('shows an error message when the Callable rejects', async () => {
    const user = userEvent.setup()
    vi.mocked(processRound).mockRejectedValue(new Error('この家庭はまだラウンドの意思決定を提出していません。'))
    render(<HouseholdRoundControlPanel lessonRunId="run-1" householdId="case-b" functions={functions} />)

    await user.click(screen.getByRole('button', { name: 'ラウンドを決算する' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('この家庭はまだラウンドの意思決定を提出していません。'))
  })
})
