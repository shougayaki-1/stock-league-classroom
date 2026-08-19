import { getFirestore } from 'firebase-admin/firestore'

/** 1回の介入で延ばせる上限。50分授業1コマを丸ごと超える延長は誤操作とみなす。 */
export const MAX_EXTEND_SECONDS = 1800

interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => unknown }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface ExtendPhaseTimerInput {
  lessonRunId: string
  phaseId: string
  additionalSeconds: number
}

export interface ExtendPhaseTimerResult {
  currentPhaseEndsAtMillis: number
}

export interface ExtendPhaseTimerDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
}

/**
 * `EXTEND_TIME` 介入の実処理。現在フェーズの終了時刻を後ろへずらす。
 *
 * `phaseId` が現在のフェーズと一致するときだけ受理する。教師が延長ボタンを
 * 押すまでの間にフェーズが進んでいた場合、古いフェーズを延ばしても意味が
 * 無いどころか、進行中のフェーズの残り時間を誤って書き換えてしまうため。
 */
export const extendPhaseTimer = async (
  deps: ExtendPhaseTimerDeps,
  input: ExtendPhaseTimerInput,
): Promise<ExtendPhaseTimerResult> => {
  if (
    !Number.isInteger(input.additionalSeconds)
    || input.additionalSeconds < 1
    || input.additionalSeconds > MAX_EXTEND_SECONDS
  ) {
    throw new Error(`additionalSeconds must be between 1 and ${MAX_EXTEND_SECONDS}`)
  }

  const result = await deps.firestore.runTransaction(async (tx) => {
    const runPath = `lessonRuns/${input.lessonRunId}`
    const snap = await tx.get(runPath)
    if (!snap.exists) throw new Error('LessonRun not found')
    const run = snap.data() as Record<string, unknown>

    if (run.currentPhaseId !== input.phaseId) throw new Error('Phase is no longer current')

    const currentEnds = run.currentPhaseEndsAtMillis
    if (typeof currentEnds !== 'number') throw new Error('Phase has no timer')

    const next = currentEnds + input.additionalSeconds * 1000
    tx.set(runPath, { ...run, currentPhaseEndsAtMillis: next })
    return { currentPhaseEndsAtMillis: next }
  })

  if (deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }
  return result
}

export const extendPhaseTimerWithAdminSdk = (input: ExtendPhaseTimerInput): Promise<ExtendPhaseTimerResult> => {
  const db = getFirestore()
  return extendPhaseTimer({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
  }, input)
}
