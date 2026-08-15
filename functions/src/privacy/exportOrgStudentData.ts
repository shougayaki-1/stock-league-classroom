import { getFirestore } from 'firebase-admin/firestore'

export interface ExportOrgStudentDataDeps {
  orgId: string
  listLessonRuns: () => Promise<Record<string, unknown>[]>
  listParticipants: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listTeamAccounts: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listOrders: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listHouseholds: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listHouseholdDecisions: (lessonRunId: string, householdId: string) => Promise<Record<string, unknown>[]>
  now?: () => string
}

/**
 * Spec §21.7: org-wide bulk export scope. Deliberately narrower than
 * exportPersonalData — only the sub-collections that hold student-generated
 * data (participants/teamAccounts/orders/households), not templates or
 * operational replay logs (events/checkpoints).
 */
export const exportOrgStudentData = async (deps: ExportOrgStudentDataDeps) => {
  const runs = await deps.listLessonRuns()
  const lessonRuns = await Promise.all(runs.map(async (run) => {
    const runId = run.id as string
    const [participants, teamAccounts, orders, households] = await Promise.all([
      deps.listParticipants(runId), deps.listTeamAccounts(runId), deps.listOrders(runId), deps.listHouseholds(runId),
    ])
    const householdsWithDecisions = await Promise.all(households.map(async (household) => ({
      ...household, decisions: await deps.listHouseholdDecisions(runId, household.id as string),
    })))
    return { ...run, participants, teamAccounts, orders, households: householdsWithDecisions }
  }))
  return {
    exportedAt: (deps.now ?? (() => new Date().toISOString()))(),
    orgId: deps.orgId,
    lessonRuns,
  }
}

/**
 * Production wiring: Firestore Admin SDK collection queries scoped by
 * orgId/lessonRunId. Callers MUST have already verified authorization
 * (owner role + fresh reauth — see onCall.ts) before invoking this.
 */
export const exportOrgStudentDataWithAdminSdk = (orgId: string): ReturnType<typeof exportOrgStudentData> => {
  const db = getFirestore()
  const listCollection = async (query: FirebaseFirestore.Query): Promise<Record<string, unknown>[]> => {
    const snap = await query.get()
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  }
  return exportOrgStudentData({
    orgId,
    listLessonRuns: () => listCollection(db.collection('lessonRuns').where('orgId', '==', orgId)),
    listParticipants: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/participants`)),
    listTeamAccounts: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/teamAccounts`)),
    listOrders: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/orders`)),
    listHouseholds: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/households`)),
    listHouseholdDecisions: (lessonRunId, householdId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/households/${householdId}/decisions`)),
  })
}
