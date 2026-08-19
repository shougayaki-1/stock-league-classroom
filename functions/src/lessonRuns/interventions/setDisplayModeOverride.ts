import { getFirestore } from 'firebase-admin/firestore'
import type { LessonRunDisplayMode } from '../projections/displayProjection'

/**
 * 教師が手動で指定できる教室表示のモード。`LessonRunDisplayMode` の全値を
 * そのまま採用する。`HOUSEHOLD_COMPARISON` を比較データが無い状態で選んだ
 * 場合は `ClassroomDisplayPage` が解説画面へフォールバックする（同ファイルの
 * HOUSEHOLD_COMPARISON case 参照）ので、ここで弾く必要はない。
 */
export const SWITCHABLE_DISPLAY_MODES: readonly LessonRunDisplayMode[] = [
  'START', 'LIVE', 'END', 'EXPLANATION', 'HOUSEHOLD_COMPARISON',
]

export interface SetDisplayModeOverrideInput {
  lessonRunId: string
  displayMode: LessonRunDisplayMode | null
}

export interface SetDisplayModeOverrideDeps {
  updateRun: (path: string, patch: Record<string, unknown>) => Promise<void>
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
}

/**
 * `SWITCH_DISPLAY_MODE` 介入の実処理。`displayMode: null` は上書きの解除
 * （status からの自動導出に戻す）を意味する。
 */
export const setDisplayModeOverride = async (
  deps: SetDisplayModeOverrideDeps,
  input: SetDisplayModeOverrideInput,
): Promise<{ displayModeOverride: LessonRunDisplayMode | null }> => {
  if (input.displayMode !== null && !SWITCHABLE_DISPLAY_MODES.includes(input.displayMode)) {
    throw new Error('Unknown display mode')
  }

  await deps.updateRun(`lessonRuns/${input.lessonRunId}`, { displayModeOverride: input.displayMode })

  if (deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }
  return { displayModeOverride: input.displayMode }
}

export const setDisplayModeOverrideWithAdminSdk = (
  input: SetDisplayModeOverrideInput,
): Promise<{ displayModeOverride: LessonRunDisplayMode | null }> => {
  const db = getFirestore()
  return setDisplayModeOverride({
    updateRun: async (path, patch) => { await db.doc(path).update(patch) },
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
  }, input)
}
