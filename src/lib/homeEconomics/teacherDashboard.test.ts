import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { getHouseholdTeacherDashboard } = await import('./teacherDashboard')

describe('getHouseholdTeacherDashboard (client)', () => {
  it('calls getHouseholdTeacherDashboardCallable with lessonRunId', async () => {
    const mockDashboard = {
      lessonRunId: 'run-1',
      subject: 'HOME_ECONOMICS',
      courseFormat: 'COMMON_CONDITIONS',
      assignment: null,
      restoreGeneration: 0,
      synchronizedRoundIndex: null,
      roundStatus: null,
      currentRoundIndex: 1,
      householdsAligned: true,
      updatedAtServerMillis: 1000,
      teams: [],
      checkpoints: [],
      activeBulkOperation: null,
      finalComparisonAvailable: false,
    }
    callable.mockResolvedValue({ data: mockDashboard })
    const functions = {} as Functions

    const result = await getHouseholdTeacherDashboard(functions, { lessonRunId: 'run-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getHouseholdTeacherDashboardCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
    expect(result).toEqual(mockDashboard)
  })
})
