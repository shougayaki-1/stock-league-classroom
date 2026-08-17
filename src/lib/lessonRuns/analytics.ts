import { httpsCallable, type Functions } from 'firebase/functions'

export interface GetLessonAnalyticsInput {
  lessonRunId: string
}

export interface LessonAnalyticsAggregate {
  responseCount: number
  confirmedResponseCount: number
  surveyRespondentCount: number
  rationaleInformationUsageRate: number | null
  rationaleInformationCounts: Record<string, number>
  judgmentChangeCount: number | null
  judgmentChangeRate: number | null
  comprehensionDifficultyCount: number | null
  comprehensionAverage: number | null
  predictionAccuracyAverage: number | null
  strugglingParticipantCount: number | null
}

export interface LessonAnalyticsIndividualRow {
  participantId: string
  displayName: string
  teamId?: string
  rationaleInformationCount: number
  judgmentChanged: boolean | null
  comprehensionScore: number | null
  resultGapScore: number | null
  struggling: boolean
}

export interface GetLessonAnalyticsResult {
  lessonRunId: string
  lessonTitle: string
  totalParticipantCount: number
  aggregate: LessonAnalyticsAggregate
  teams: { teamId: string; teamName: string }[]
  individualRows: LessonAnalyticsIndividualRow[]
}

export const getLessonAnalytics = async (functions: Functions, input: GetLessonAnalyticsInput): Promise<GetLessonAnalyticsResult> => {
  const callable = httpsCallable<GetLessonAnalyticsInput, GetLessonAnalyticsResult>(functions, 'getLessonAnalyticsCallable')
  const result = await callable(input)
  return result.data
}
