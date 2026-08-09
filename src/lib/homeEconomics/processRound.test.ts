import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as submitDecision.test.ts / market/submitOrder.test.ts.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { processRound } = await import('./processRound')

describe('processRound (client)', () => {
  it('calls processRoundCallable with lessonRunId/householdId, omitting forceSettle when not given', async () => {
    const result = {
      newHouseholdState: { householdId: 'case-b' }, occurredEventIds: [], incomeYen: 0, expensesYen: 0,
      netCashFlowYen: 0, shortfallYen: 0, insuranceBenefitsYen: 0,
    }
    callable.mockResolvedValue({ data: result })
    const functions = {} as Functions

    const returned = await processRound(functions, { lessonRunId: 'run-1', householdId: 'case-b' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'processRoundCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', householdId: 'case-b' })
    expect(returned).toEqual(result)
  })

  it('forwards forceSettle: true when the teacher explicitly opts in', async () => {
    callable.mockResolvedValue({ data: {} })
    const functions = {} as Functions

    await processRound(functions, { lessonRunId: 'run-1', householdId: 'case-b', forceSettle: true })

    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', householdId: 'case-b', forceSettle: true })
  })
})
