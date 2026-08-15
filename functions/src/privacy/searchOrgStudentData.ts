import { getFirestore } from 'firebase-admin/firestore'

export type OrgStudentSearchField = 'displayName' | 'externalIdentifier'

export interface OrgStudentSearchMatch {
  lessonRunId: string
  participantId: string
  authUid?: string
  identityMode?: string
  displayName?: string
  externalIdentifier?: string
  teamId?: string
  status?: string
}

export interface OrgStudentDataSearchResult {
  expiresAt: string
  truncated: boolean
  matches: OrgStudentSearchMatch[]
}

export interface SearchOrgStudentDataDeps {
  orgId: string
  actorUid: string
  actorRole: 'owner' | 'admin'
  field: OrgStudentSearchField
  query: string
  listLessonRuns: () => Promise<Array<Record<string, unknown>>>
  findParticipants: (lessonRunId: string, field: OrgStudentSearchField, query: string) => Promise<Array<Record<string, unknown>>>
  now?: () => Date
}

const SEARCH_RESULT_MAX_AGE_MS = 10 * 60 * 1000
const MAX_SEARCH_RESULTS = 50

/**
 * Pure search logic: searches participant records in authorized lesson runs.
 * - owner: all lesson runs belonging to the organization.
 * - admin: only lesson runs where teacherRoles[actorUid] is present.
 */
export const searchOrgStudentData = async (deps: SearchOrgStudentDataDeps): Promise<OrgStudentDataSearchResult> => {
  const allRuns = await deps.listLessonRuns()

  const eligibleRuns = allRuns.filter((run) => {
    if (deps.actorRole === 'owner') return true
    if (deps.actorRole === 'admin') {
      const teacherRoles = run.teacherRoles as Record<string, unknown> | undefined
      return teacherRoles !== undefined && teacherRoles[deps.actorUid] !== undefined
    }
    return false
  })

  const rawMatches: OrgStudentSearchMatch[] = []

  for (const run of eligibleRuns) {
    const runId = run.id as string
    const participants = await deps.findParticipants(runId, deps.field, deps.query)
    for (const p of participants) {
      const match: OrgStudentSearchMatch = {
        lessonRunId: runId,
        participantId: (p.id ?? p.participantId) as string,
      }
      if (typeof p.authUid === 'string') match.authUid = p.authUid
      if (typeof p.identityMode === 'string') match.identityMode = p.identityMode
      if (typeof p.displayName === 'string') match.displayName = p.displayName
      if (typeof p.externalIdentifier === 'string') match.externalIdentifier = p.externalIdentifier
      if (typeof p.teamId === 'string') match.teamId = p.teamId
      if (typeof p.status === 'string') match.status = p.status
      rawMatches.push(match)
    }
  }

  const truncated = rawMatches.length > MAX_SEARCH_RESULTS
  const matches = rawMatches.slice(0, MAX_SEARCH_RESULTS)
  const now = (deps.now ?? (() => new Date()))()
  const expiresAt = new Date(now.getTime() + SEARCH_RESULT_MAX_AGE_MS).toISOString()

  return {
    expiresAt,
    truncated,
    matches,
  }
}

/**
 * Production wiring: Firestore Admin SDK queries scoped to authorized lesson runs.
 * Callers MUST have verified caller authentication and active org membership (owner/admin)
 * before invoking this.
 */
export const searchOrgStudentDataWithAdminSdk = (params: {
  orgId: string
  actorUid: string
  actorRole: 'owner' | 'admin'
  field: OrgStudentSearchField
  query: string
  now?: () => Date
}): Promise<OrgStudentDataSearchResult> => {
  const db = getFirestore()
  const listCollection = async (query: FirebaseFirestore.Query): Promise<Record<string, unknown>[]> => {
    const snap = await query.get()
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  }
  return searchOrgStudentData({
    ...params,
    listLessonRuns: () => listCollection(db.collection('lessonRuns').where('orgId', '==', params.orgId)),
    findParticipants: (lessonRunId, field, query) =>
      listCollection(db.collection(`lessonRuns/${lessonRunId}/participants`).where(field, '==', query)),
  })
}
