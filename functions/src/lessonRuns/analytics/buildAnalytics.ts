/**
 * Pure aggregation layer for Task 15's teacher-facing lesson analytics.
 *
 * Deliberately mirrors `results/buildResults.ts`'s design: no Firestore/
 * Callable concerns live here — a future Callable (see this module's own
 * lack of one, explained below) fetches events/responses/surveys and hands
 * them to `buildLessonAnalytics`, exactly like `buildLessonResult` is fed by
 * `buildAndPersistLessonResult`'s Admin SDK wiring.
 *
 * §Task 15 brief Step 1 lists six metrics: 利用情報割合 (rationale
 * information usage), 判断変更箇所 (judgment-change points), 理解困難箇所
 * (comprehension-difficulty points), 予想精度 (prediction accuracy), 理解度
 * (comprehension level), 操作つまずき人数 (operational-struggle headcount).
 * The event log has no central `type` enum (confirmed via `grep -rn "type:
 * '" functions/src/lessonRuns` before writing this, same check
 * `buildResults.ts` already documents) and — critically — no
 * "STUDENT_HELP_REQUESTED"-shaped event exists anywhere in the codebase.
 * Every metric below is therefore derived from the concrete event/response/
 * survey shapes that Task 5-14 actually produce, not from an invented event
 * type:
 *
 *  - 利用情報割合: `LessonResponse.rationaleInformationIds` (Task 7) on
 *    CONFIRMED responses only (a DRAFT/PROPOSED response's rationale hasn't
 *    been finalized yet, matching `buildLessonResult`'s own CONFIRMED-only
 *    filter).
 *  - 判断変更箇所 / 理解度 / 予想精度: the `JUDGMENT_CHANGED` /
 *    `COMPREHENSION` / `RESULT_GAP` survey questions (Task 14's
 *    `SURVEY_QUESTION_CATALOG`) — these are literally the self-reported
 *    signals the survey schema was designed to capture, so re-deriving them
 *    from the event log would be redundant and less accurate than reading
 *    the student's own answer directly.
 *  - 操作つまずき人数: `TEACHER_INTERVENTION_APPLIED` events (Task 9) whose
 *    `interventionType` is `PROXY_CONFIRM` (the teacher had to confirm a
 *    response *for* a student who could not do it themselves) or
 *    `RECONNECT_PARTICIPANT` (the student's device/session broke and needed
 *    teacher-mediated recovery). Both are, by construction, a teacher
 *    stepping in because a specific participant could not complete an
 *    operation on their own — the closest concrete proxy this event log has
 *    for "operation stumbling". `CORRECT_STATE`/`EMERGENCY_STOP`/etc. are
 *    deliberately excluded: they are teacher-initiated corrections, not
 *    evidence of a student struggling.
 *
 * NULL vs 0 (brief Step 1's explicit requirement): every scalar/average
 * metric is `null` when there is no data to compute it from (e.g. zero
 * survey responses at all), and a real number — including legitimately `0`
 * — whenever at least one relevant data point exists. `strugglingParticipantCount`
 * is `null` only when `events` itself is empty (nothing was recorded at all,
 * so this metric cannot be evaluated); once at least one event exists, `0`
 * is a meaningful, distinct answer ("we checked, and nobody struggled").
 */

export interface AnalyticsEvent {
  type: string
  payload: unknown
}

export interface AnalyticsResponse {
  id: string
  participantId?: string
  teamId?: string
  status: string
  rationaleInformationIds: string[]
}

export interface AnalyticsSurveyResponse {
  id: string
  participantId: string
  /** Keyed by `LessonSurveyQuestionType` (surveys/schema.ts), loose JSON values — matches `LessonSurveyResponse.answers`. */
  answers: Record<string, unknown>
}

export interface LessonAnalyticsIndividualRow {
  participantId: string
  teamId?: string
  /** Sum of `rationaleInformationIds.length` across this participant's CONFIRMED responses. */
  rationaleInformationCount: number
  /** `null` when this participant never answered the JUDGMENT_CHANGED question. */
  judgmentChanged: boolean | null
  /** `null` when this participant never answered the COMPREHENSION question. */
  comprehensionScore: number | null
  /** `null` when this participant never answered the RESULT_GAP question. */
  resultGapScore: number | null
  /** `true` when a PROXY_CONFIRM/RECONNECT_PARTICIPANT intervention targeted this participant. */
  struggling: boolean
}

export interface LessonAnalyticsAggregate {
  responseCount: number
  confirmedResponseCount: number
  surveyRespondentCount: number
  /** 0..1, or `null` when there are zero CONFIRMED responses to measure. */
  rationaleInformationUsageRate: number | null
  /** informationId -> number of CONFIRMED responses that cited it. Empty object (not null) when there is no data — this is a breakdown, not a scalar average. */
  rationaleInformationCounts: Record<string, number>
  /** Count of survey respondents who answered JUDGMENT_CHANGED truthily. `null` when nobody answered that question. */
  judgmentChangeCount: number | null
  /** judgmentChangeCount / (number of respondents who answered JUDGMENT_CHANGED). `null` under the same condition as judgmentChangeCount. */
  judgmentChangeRate: number | null
  /** Count of COMPREHENSION answers <= 2 (of a 1-5 scale). `null` when nobody answered COMPREHENSION. */
  comprehensionDifficultyCount: number | null
  /** Average COMPREHENSION answer. `null` when nobody answered COMPREHENSION. */
  comprehensionAverage: number | null
  /** Average RESULT_GAP answer (raw 1-5 Likert scale as configured by the survey UI — this module does not assume or invert its polarity). `null` when nobody answered RESULT_GAP. */
  predictionAccuracyAverage: number | null
  /** Distinct participants targeted by a PROXY_CONFIRM/RECONNECT_PARTICIPANT intervention. `null` only when `events` was empty (no data at all); `0` once events exist but none indicate struggle. */
  strugglingParticipantCount: number | null
}

export interface LessonAnalytics {
  lessonRunId: string
  aggregate: LessonAnalyticsAggregate
  /** One row per distinct participant seen across `responses`/`surveys` (team-scoped-only responses with no `participantId` are counted in the aggregate but do not produce a row — there is no individual to attribute them to). */
  individualRows: LessonAnalyticsIndividualRow[]
}

export interface BuildLessonAnalyticsInput {
  lessonRunId: string
  events: AnalyticsEvent[]
  responses: AnalyticsResponse[]
  surveys: AnalyticsSurveyResponse[]
}

const COMPREHENSION_DIFFICULTY_THRESHOLD = 2

const asRecord = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === 'object') ? (value as Record<string, unknown>) : {}

const toFiniteNumber = (value: unknown): number | null =>
  (typeof value === 'number' && Number.isFinite(value)) ? value : null

/** Truthy per the JUDGMENT_CHANGED question's boolean-ish answer contract: `true`/non-zero-number/'YES' count as changed, everything else (including unanswered) does not. */
const isJudgmentChangedTruthy = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value === 'YES' || value === 'true'
  return false
}

/**
 * Distinct participantIds targeted by a struggle-indicating intervention.
 * Reads `impactScope.participantId` when the intervention was scoped to a
 * single participant, falling back to the intervention's own `detail`
 * fields (`onBehalfOfParticipantId` for PROXY_CONFIRM, `participantId` for
 * RECONNECT_PARTICIPANT — see interventions.ts's `REQUIRED_DETAIL_KEYS`) for
 * events recorded before/without a matching `impactScope`.
 */
const extractStrugglingParticipantIds = (events: AnalyticsEvent[]): Set<string> => {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type !== 'TEACHER_INTERVENTION_APPLIED') continue
    const payload = asRecord(event.payload)
    const interventionType = payload.interventionType
    if (interventionType !== 'PROXY_CONFIRM' && interventionType !== 'RECONNECT_PARTICIPANT') continue

    const impactScope = asRecord(payload.impactScope)
    const detail = asRecord(payload.detail)
    const participantId = impactScope.level === 'PARTICIPANT'
      ? impactScope.participantId
      : (detail.onBehalfOfParticipantId ?? detail.participantId)

    if (typeof participantId === 'string') ids.add(participantId)
  }
  return ids
}

export const buildLessonAnalytics = (input: BuildLessonAnalyticsInput): LessonAnalytics => {
  const confirmedResponses = input.responses.filter((response) => response.status === 'CONFIRMED')

  // ---- 利用情報割合 (rationale information usage) ----
  const rationaleInformationCounts: Record<string, number> = {}
  for (const response of confirmedResponses) {
    for (const informationId of response.rationaleInformationIds) {
      rationaleInformationCounts[informationId] = (rationaleInformationCounts[informationId] ?? 0) + 1
    }
  }
  const rationaleInformationUsageRate = confirmedResponses.length === 0
    ? null
    : confirmedResponses.filter((response) => response.rationaleInformationIds.length > 0).length / confirmedResponses.length

  // ---- 判断変更箇所 / 理解度 / 予想精度 (survey-derived) ----
  const judgmentChangedAnswers = input.surveys.filter((survey) => 'JUDGMENT_CHANGED' in survey.answers)
  const judgmentChangeCount = judgmentChangedAnswers.length === 0
    ? null
    : judgmentChangedAnswers.filter((survey) => isJudgmentChangedTruthy(survey.answers.JUDGMENT_CHANGED)).length
  const judgmentChangeRate = judgmentChangedAnswers.length === 0
    ? null
    : (judgmentChangeCount as number) / judgmentChangedAnswers.length

  const comprehensionScores = input.surveys
    .map((survey) => toFiniteNumber(survey.answers.COMPREHENSION))
    .filter((score): score is number => score !== null)
  const comprehensionAverage = comprehensionScores.length === 0
    ? null
    : comprehensionScores.reduce((total, score) => total + score, 0) / comprehensionScores.length
  const comprehensionDifficultyCount = comprehensionScores.length === 0
    ? null
    : comprehensionScores.filter((score) => score <= COMPREHENSION_DIFFICULTY_THRESHOLD).length

  const resultGapScores = input.surveys
    .map((survey) => toFiniteNumber(survey.answers.RESULT_GAP))
    .filter((score): score is number => score !== null)
  const predictionAccuracyAverage = resultGapScores.length === 0
    ? null
    : resultGapScores.reduce((total, score) => total + score, 0) / resultGapScores.length

  // ---- 操作つまずき人数 (operational struggle) ----
  const strugglingParticipantIds = extractStrugglingParticipantIds(input.events)
  const strugglingParticipantCount = input.events.length === 0 ? null : strugglingParticipantIds.size

  // ---- Per-participant rows ----
  const participantIds = new Set<string>()
  for (const response of input.responses) if (response.participantId) participantIds.add(response.participantId)
  for (const survey of input.surveys) participantIds.add(survey.participantId)

  const individualRows: LessonAnalyticsIndividualRow[] = [...participantIds].map((participantId) => {
    const ownConfirmedResponses = confirmedResponses.filter((response) => response.participantId === participantId)
    const ownSurvey = input.surveys.find((survey) => survey.participantId === participantId)
    const teamId = input.responses.find((response) => response.participantId === participantId && response.teamId)?.teamId

    return {
      participantId,
      ...(teamId ? { teamId } : {}),
      rationaleInformationCount: ownConfirmedResponses.reduce((total, response) => total + response.rationaleInformationIds.length, 0),
      judgmentChanged: ownSurvey && 'JUDGMENT_CHANGED' in ownSurvey.answers ? isJudgmentChangedTruthy(ownSurvey.answers.JUDGMENT_CHANGED) : null,
      comprehensionScore: ownSurvey ? toFiniteNumber(ownSurvey.answers.COMPREHENSION) : null,
      resultGapScore: ownSurvey ? toFiniteNumber(ownSurvey.answers.RESULT_GAP) : null,
      struggling: strugglingParticipantIds.has(participantId),
    }
  })

  return {
    lessonRunId: input.lessonRunId,
    aggregate: {
      responseCount: input.responses.length,
      confirmedResponseCount: confirmedResponses.length,
      surveyRespondentCount: new Set(input.surveys.map((survey) => survey.participantId)).size,
      rationaleInformationUsageRate,
      rationaleInformationCounts,
      judgmentChangeCount,
      judgmentChangeRate,
      comprehensionDifficultyCount,
      comprehensionAverage,
      predictionAccuracyAverage,
      strugglingParticipantCount,
    },
    individualRows,
  }
}
