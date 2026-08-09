import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from 'firebase/database'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock pattern as LessonControlRoom.test.tsx: real
// client wrappers (subscribeOwnTeamState / submitHouseholdDecision) run
// against faked Firebase SDK calls, so this exercises the actual wiring.
// The component under test is imported dynamically AFTER these vi.mock
// calls (not statically at the top) for the same hoisting reason
// LessonControlRoom.test.tsx documents at its own dynamic import site.
const refMock = vi.fn((_database: unknown, path: string) => ({ __path: path }))
let capturedListener: ((snapshot: { val: () => unknown }) => void) | undefined
const onValueMock = vi.fn((_nodeRef: { __path: string }, onNext: (s: { val: () => unknown }) => void) => {
  capturedListener = onNext
  return () => {}
})
vi.mock('firebase/database', () => ({ ref: refMock, onValue: onValueMock, off: vi.fn() }))

const callableMock = vi.fn().mockResolvedValue({ data: { decisionId: 'dec-1', created: true } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callableMock) }))

const { HouseholdTeamScreen } = await import('./HouseholdTeamScreen')

const household = {
  householdId: 'team-a', cashYen: 500000, lifeStage: 'CHILD_REARING', roundIndex: 0,
  assetHoldingsYen: { DOMESTIC_STOCK: 100000 }, visibleConcepts: [], eventDisclosures: [], shortfallOptions: [],
}

describe('HouseholdTeamScreen', () => {
  it('renders nothing until the team state has loaded', () => {
    render(<HouseholdTeamScreen lessonRunId="run-1" teamId="team-a" database={{} as Database} functions={{} as Functions} />)
    expect(screen.queryByText('team-a')).not.toBeInTheDocument()
  })

  it('renders the household once lessonRunTeamState/{runId}/{teamId} resolves, and submits via the real Callable wrapper', async () => {
    const user = userEvent.setup()
    render(<HouseholdTeamScreen lessonRunId="run-1" teamId="team-a" database={{} as Database} functions={{} as Functions} />)

    act(() => { capturedListener?.({ val: () => ({ household }) }) })

    expect(screen.getByText('team-a')).toBeInTheDocument()
    expect(refMock).toHaveBeenCalledWith({}, 'lessonRunTeamState/run-1/team-a')

    await user.click(screen.getByRole('button', { name: '今回の意思決定を提出する' }))

    expect(callableMock).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', householdId: 'team-a', roundIndex: 0, shortfallResolutionType: null,
    }))
    expect(await screen.findByText('提出しました。')).toBeInTheDocument()
  })
})
