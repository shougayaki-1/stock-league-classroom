import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { loadAuthorizedRun } from '../lifecycle/onCall'
import { buildLessonAnalytics, type AnalyticsEvent, type AnalyticsResponse, type AnalyticsSurveyResponse, type LessonAnalyticsAggregate, type LessonAnalyticsIndividualRow } from './buildAnalytics'

interface GetLessonAnalyticsRequest {
  lessonRunId: string
}

export interface GetLessonAnalyticsTeam {
  teamId: string
  teamName: string
}

export interface GetLessonAnalyticsIndividualRow extends LessonAnalyticsIndividualRow {
  displayName: string
}

export interface GetLessonAnalyticsResult {
  lessonRunId: string
  lessonTitle: string
  totalParticipantCount: number
  aggregate: LessonAnalyticsAggregate
  teams: GetLessonAnalyticsTeam[]
  individualRows: GetLessonAnalyticsIndividualRow[]
}

/**
 * Teacher-only, read-only (VIEW_RESULTS — open to PRIMARY/ASSISTANT/VIEWER,
 * matching every role's existing "看板/概要は見られる" tier). Computes
 * analytics live from `events`/`responses`/the latest result's
 * `surveyResponses` on every call — unlike results (Phase 4), there is no
 * separate "generate" step, since `buildLessonAnalytics` already handles
 * zero-data input by returning `null` metrics rather than needing a
 * persisted precomputed snapshot.
 */
export const getLessonAnalyticsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as GetLessonAnalyticsRequest
  if (!data.lessonRunId) throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')
  await loadAuthorizedRun(request, data.lessonRunId, 'VIEW_RESULTS')

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  const lessonTitle = (runSnap.data() as { templateSnapshot?: { title?: string } } | undefined)?.templateSnapshot?.title ?? ''

  const [participantsSnap, teamsSnap, eventsSnap, responsesSnap, resultsSnap] = await Promise.all([
    db.collection(`lessonRuns/${data.lessonRunId}/participants`).get(),
    db.collection(`lessonRuns/${data.lessonRunId}/teams`).get(),
    db.collection(`lessonRuns/${data.lessonRunId}/events`).orderBy('sequence').get(),
    db.collection(`lessonRuns/${data.lessonRunId}/responses`).get(),
    db.collection(`lessonRuns/${data.lessonRunId}/results`).orderBy('generatedAt', 'desc').limit(1).get(),
  ])

  const participants = participantsSnap.docs.map((doc) => doc.data() as { id: string; displayName: string; teamId?: string })
  const displayNameById = new Map(participants.map((participant) => [participant.id, participant.displayName]))
  const teams: GetLessonAnalyticsTeam[] = teamsSnap.docs.map((doc) => ({
    teamId: doc.id,
    teamName: (doc.data() as { displayName?: string }).displayName ?? doc.id,
  }))

  const events: AnalyticsEvent[] = eventsSnap.docs.map((doc) => doc.data() as AnalyticsEvent)
  const responses: AnalyticsResponse[] = responsesSnap.docs.map((doc) => {
    const raw = doc.data() as { id: string; participantId?: string; teamId?: string; status: string; rationaleInformationIds?: string[] }
    return { id: raw.id, participantId: raw.participantId, teamId: raw.teamId, status: raw.status, rationaleInformationIds: raw.rationaleInformationIds ?? [] }
  })

  let surveys: AnalyticsSurveyResponse[] = []
  if (!resultsSnap.empty) {
    const resultId = resultsSnap.docs[0].id
    const surveysSnap = await db.collection(`lessonRuns/${data.lessonRunId}/results/${resultId}/surveyResponses`).get()
    surveys = surveysSnap.docs.map((doc) => doc.data() as AnalyticsSurveyResponse)
  }

  const analytics = buildLessonAnalytics({ lessonRunId: data.lessonRunId, events, responses, surveys })

  return {
    lessonRunId: data.lessonRunId,
    lessonTitle,
    totalParticipantCount: participants.length,
    aggregate: analytics.aggregate,
    teams,
    individualRows: analytics.individualRows.map((row) => ({
      ...row,
      displayName: displayNameById.get(row.participantId) ?? row.participantId,
    })),
  } satisfies GetLessonAnalyticsResult
})
