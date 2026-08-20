/**
 * `functions/src/lessonRuns/phases/phaseLabel.ts` の手動同期版。
 * `functions/` と `src/` は型モジュールを共有しないため（`LessonRunStatus`
 * 等と同じ「duplicated by necessity」の慣行）、同じ判定をこちらにも置く。
 * 片方を変えたらもう片方も変えること。
 *
 * `displayConfig` は形が固定されていない `unknown` であり、Firestore から
 * 読んだ値も信用できない。想定外の形では例外を投げず `null` を返す。
 */
export interface PhaseWithDisplayConfig {
  id: string
  type?: string
  nextPhaseIds?: string[]
  displayConfig?: unknown
}

export const readPhaseLabel = (phase: PhaseWithDisplayConfig | undefined | null): string | null => {
  if (!phase) return null
  const displayConfig = phase.displayConfig
  if (typeof displayConfig !== 'object' || displayConfig === null) return null
  const label = (displayConfig as { label?: unknown }).label
  if (typeof label !== 'string') return null
  const trimmed = label.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const findPhaseLabel = (
  phases: PhaseWithDisplayConfig[] | undefined | null,
  phaseId: string | null,
): string | null => {
  if (!phases || !phaseId) return null
  return readPhaseLabel(phases.find((phase) => phase.id === phaseId))
}
