import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { deriveDisplayMode, toLessonRunDisplayState, type LessonRunDisplayState } from './displayProjection'
import { buildProjectionSource, type BuildProjectionSourceDeps } from './buildProjectionSource'

export interface SetTeacherGuidanceInput { lessonRunId: string; teacherGuidance: string }
export interface SetTeacherGuidanceResult { teacherGuidance: string | null }
export interface SetTeacherGuidanceDeps {
  updateRun: (lessonRunId: string, patch: { teacherGuidance: string | null }) => Promise<void>
  source: BuildProjectionSourceDeps
  setDisplayState: (id: string, state: LessonRunDisplayState) => Promise<void>
  now?: () => number
}

/**
 * 教室表示のメッセージを保存し、教室表示を発行し直す。
 *
 * source の組み立ては `buildProjectionSource` に一本化した（従来はこの関数が
 * title/teams/goal を自前で拾う簡易版を持っていた）。`deriveDisplayMode` は
 * `toLessonRunDisplayState` の内部で使われるため、ここでは直接呼ばない。
 */
export const setTeacherGuidance = async (
  { updateRun, source, setDisplayState, now }: SetTeacherGuidanceDeps,
  { lessonRunId, teacherGuidance }: SetTeacherGuidanceInput,
): Promise<SetTeacherGuidanceResult> => {
  const normalized = teacherGuidance === '' ? null : teacherGuidance
  await updateRun(lessonRunId, { teacherGuidance: normalized })

  const nowMillis = now ? now() : Date.now()
  const projectionSource = await buildProjectionSource({ ...source, now: () => nowMillis }, lessonRunId)
  if (!projectionSource) throw new Error('LessonRun not found')

  await setDisplayState(lessonRunId, toLessonRunDisplayState(projectionSource, nowMillis))
  return { teacherGuidance: normalized }
}

export const setTeacherGuidanceWithAdminSdk = (input: SetTeacherGuidanceInput): Promise<SetTeacherGuidanceResult> => {
  const db = getFirestore()
  return setTeacherGuidance({
    updateRun: async (id, patch) => { await db.doc(`lessonRuns/${id}`).update(patch) },
    source: {
      getRun: async (id) => {
        const snap = await db.doc(`lessonRuns/${id}`).get()
        return snap.exists ? (snap.data() as Record<string, unknown>) : null
      },
      getTeams: async (id) => {
        const snap = await db.collection(`lessonRuns/${id}/teams`).get()
        return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      },
    },
    setDisplayState: (id, state) => getDatabase().ref(`lessonRunDisplay/${id}`).set(state),
  }, input)
}

export { deriveDisplayMode }
