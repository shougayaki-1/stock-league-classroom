import { getFirestore } from 'firebase-admin/firestore'

interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => unknown }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface SetInformationHiddenInput {
  lessonRunId: string
  informationId: string
  hidden: boolean
}

export interface SetInformationHiddenDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  publishResearchDeskProjection?: (lessonRunId: string) => Promise<void>
}

/**
 * `HIDE_INFORMATION` 介入の実処理。`lessonRun.hiddenInformationIds` を
 * 出し入れし、research desk projection を発行し直す。
 *
 * 対象はニュース項目 (`informationItems`) のみ。`economicIndicators` は
 * 介入名（情報の非表示化）が指す対象ではないため触らない。
 *
 * `hidden: false` で元に戻せる。戻せない一方向の操作は授業中の誤操作から
 * 復帰できず、教師が押すことをためらう操作になるため。
 */
export const setInformationHidden = async (
  deps: SetInformationHiddenDeps,
  input: SetInformationHiddenInput,
): Promise<{ hiddenInformationIds: string[] }> => {
  const result = await deps.firestore.runTransaction(async (tx) => {
    const runPath = `lessonRuns/${input.lessonRunId}`
    const snap = await tx.get(runPath)
    if (!snap.exists) throw new Error('LessonRun not found')
    const run = snap.data() as Record<string, unknown>

    const current = Array.isArray(run.hiddenInformationIds) ? (run.hiddenInformationIds as string[]) : []
    const next = input.hidden
      ? (current.includes(input.informationId) ? current : [...current, input.informationId])
      : current.filter((id) => id !== input.informationId)

    tx.set(runPath, { ...run, hiddenInformationIds: next })
    return { hiddenInformationIds: next }
  })

  if (deps.publishResearchDeskProjection) {
    await deps.publishResearchDeskProjection(input.lessonRunId)
  }
  return result
}

export const setInformationHiddenWithAdminSdk = (
  input: SetInformationHiddenInput,
): Promise<{ hiddenInformationIds: string[] }> => {
  const db = getFirestore()
  return setInformationHidden({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    publishResearchDeskProjection: async (id) => {
      const { publishResearchDeskProjectionWithAdminSdk } = await import('../../market/researchDeskProjection')
      await publishResearchDeskProjectionWithAdminSdk(id)
    },
  }, input)
}
