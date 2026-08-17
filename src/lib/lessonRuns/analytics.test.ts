import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import type { Functions } from 'firebase/functions'
import { getLessonAnalytics } from './analytics'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('getLessonAnalytics', () => {
  it('calls getLessonAnalyticsCallable with the lessonRunId', async () => {
    const responseData = {
      lessonRunId: 'run-1', lessonTitle: '株式投資シミュレーション', totalParticipantCount: 2,
      aggregate: {
        responseCount: 1, confirmedResponseCount: 1, surveyRespondentCount: 0,
        rationaleInformationUsageRate: 1, rationaleInformationCounts: { 'info-1': 1 },
        judgmentChangeCount: null, judgmentChangeRate: null, comprehensionDifficultyCount: null,
        comprehensionAverage: null, predictionAccuracyAverage: null, strugglingParticipantCount: null,
      },
      teams: [{ teamId: 'team-a', teamName: 'Aチーム' }],
      individualRows: [],
    }
    const callable = vi.fn().mockResolvedValue({ data: responseData })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const functions = {} as Functions
    const result = await getLessonAnalytics(functions, { lessonRunId: 'run-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getLessonAnalyticsCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
    expect(result).toEqual(responseData)
  })
})
