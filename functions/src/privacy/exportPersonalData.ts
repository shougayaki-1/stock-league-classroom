import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'

export interface ExportPersonalDataDeps {
  uid: string
  orgId: string
  getUser: () => Promise<Record<string, unknown> | null>
  getOrganization: () => Promise<Record<string, unknown> | null>
  getMembership: () => Promise<Record<string, unknown> | null>
  getOrgAccessMirror: () => Promise<Record<string, unknown> | null>
  getOrgAccessMeta: () => Promise<Record<string, unknown> | null>
  listLessonTemplates: () => Promise<Record<string, unknown>[]>
  listLessonVersions: (templateId: string) => Promise<Record<string, unknown>[]>
  listLessonRuns: () => Promise<Record<string, unknown>[]>
  listLessonEvents: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listLessonCheckpoints: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  now?: () => string
}

/**
 * Spec §21.1: personal export is a baseline feature, not paid/enterprise
 * only. Phase A's scope is everything a personal org owns directly —
 * identity, authorization records, templates, their versions, runs, and
 * runs' event/checkpoint history.
 * Phase B+ will extend this once participant-owned data (results,
 * transcripts) exists.
 */
export const exportPersonalData = async (deps: ExportPersonalDataDeps) => {
  const [user, organization, membership, orgAccessMirror, orgAccessMeta] = await Promise.all([
    deps.getUser(), deps.getOrganization(), deps.getMembership(),
    deps.getOrgAccessMirror(), deps.getOrgAccessMeta(),
  ])
  const templates = await deps.listLessonTemplates()
  const lessonTemplates = await Promise.all(templates.map(async (template) => ({
    ...template, versions: await deps.listLessonVersions(template.id as string),
  })))
  const runs = await deps.listLessonRuns()
  const lessonRuns = await Promise.all(runs.map(async (run) => ({
    ...run,
    events: await deps.listLessonEvents(run.id as string),
    checkpoints: await deps.listLessonCheckpoints(run.id as string),
  })))
  return {
    exportedAt: (deps.now ?? (() => new Date().toISOString()))(),
    uid: deps.uid, orgId: deps.orgId,
    user, organization, membership, orgAccessMirror, orgAccessMeta,
    lessonTemplates, lessonRuns,
  }
}

/**
 * Production wiring: Firestore Admin SDK doc reads + collection queries
 * scoped by orgId, plus RTDB Admin SDK reads for the two access-mirror
 * documents. Callers MUST have already verified authorization (ownership,
 * not membership — see onCall.ts) before invoking this; it performs no
 * authorization of its own, mirroring createLessonRunWithAdminSdk/
 * restoreCheckpointWithAdminSdk's separation of authz from data access.
 */
export const exportPersonalDataWithAdminSdk = (uid: string, orgId: string): ReturnType<typeof exportPersonalData> => {
  const db = getFirestore()
  const rtdb = getDatabase()

  const getDoc = async (path: string): Promise<Record<string, unknown> | null> => {
    const snap = await db.doc(path).get()
    return snap.exists ? ((snap.data() as Record<string, unknown>) ?? null) : null
  }
  const getRtdbNode = async (path: string): Promise<Record<string, unknown> | null> => {
    const snap = await rtdb.ref(path).get()
    return snap.exists() ? (snap.val() as Record<string, unknown>) : null
  }
  const listCollection = async (query: FirebaseFirestore.Query): Promise<Record<string, unknown>[]> => {
    const snap = await query.get()
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  }

  return exportPersonalData({
    uid,
    orgId,
    getUser: () => getDoc(`users/${uid}`),
    getOrganization: () => getDoc(`organizations/${orgId}`),
    getMembership: () => getDoc(`organizations/${orgId}/members/${uid}`),
    getOrgAccessMirror: () => getRtdbNode(`orgAccess/${orgId}/${uid}`),
    getOrgAccessMeta: () => getRtdbNode(`orgAccessMeta/${orgId}/${uid}`),
    listLessonTemplates: () => listCollection(db.collection('lessonTemplates').where('orgId', '==', orgId)),
    listLessonVersions: (templateId) => listCollection(db.collection(`lessonTemplates/${templateId}/versions`)),
    listLessonRuns: () => listCollection(db.collection('lessonRuns').where('orgId', '==', orgId)),
    listLessonEvents: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/events`)),
    listLessonCheckpoints: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/checkpoints`)),
  })
}
