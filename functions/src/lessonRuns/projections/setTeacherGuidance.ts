import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { deriveDisplayMode, type LessonRunDisplayState } from './displayProjection'
export interface SetTeacherGuidanceInput { lessonRunId: string; teacherGuidance: string }
export interface SetTeacherGuidanceResult { teacherGuidance: string | null }
export interface SetTeacherGuidanceDeps { firestore: any; setDisplayState: (id: string, state: LessonRunDisplayState) => Promise<void>; now?: () => number }
export const setTeacherGuidance = async ({ firestore, setDisplayState, now }: SetTeacherGuidanceDeps, { lessonRunId, teacherGuidance }: SetTeacherGuidanceInput): Promise<SetTeacherGuidanceResult> => {
  const normalized = teacherGuidance === '' ? null : teacherGuidance; const run = firestore.doc(`lessonRuns/${lessonRunId}`); await run.update({ teacherGuidance: normalized }); const data = (await run.get()).data(); const docs = (await firestore.collection(`lessonRuns/${lessonRunId}/teams`).get()).docs
  await setDisplayState(lessonRunId, { orgId: data.orgId, mode: deriveDisplayMode(data.status), title: data.templateSnapshot?.title ?? '', goal: null, teams: docs.map((item: any) => { const team = item.data(); return { teamId: team.id, displayName: team.displayName, publicAggregateLabel: null } }), teacherGuidance: normalized, updatedAtMillis: now?.() ?? Date.now() })
  return { teacherGuidance: normalized }
}
export const setTeacherGuidanceWithAdminSdk = (input: SetTeacherGuidanceInput) => { const db = getFirestore(); const firestore = { doc: (path: string) => db.doc(path), collection: (path: string) => ({ get: async () => { const snap = await db.collection(path).get(); return { docs: snap.docs.map((doc) => ({ data: () => ({ id: doc.id, ...doc.data() }) })) } } }) }; return setTeacherGuidance({ firestore, setDisplayState: (id, state) => getDatabase().ref(`lessonRunDisplay/${id}`).set(state) }, input) }
