/**
 * `LessonPhase.displayConfig` は §7.5 が「生徒公開情報」の入れ物として
 * 定めるだけで形を固定していないため、`validation.ts` では `unknown` 型で
 * ある。Firestore の `templateSnapshot.phases` から読んだ値も同様に信用
 * できない。ラベルの取り出しをここ1箇所に集め、想定外の形では例外を投げず
 * `null` を返す（教室に投影される画面が壊れるより、ラベルが出ない方が軽い）。
 *
 * クライアント側の `src/lib/lessonRuns/phaseLabel.ts` は本ファイルの手動
 * 同期版である。`functions/tsconfig.json` の `rootDir: "src"` により
 * `functions/src` からリポジトリ直下の `src/` を import できないため、
 * このコードベースの既存慣行（`LessonRunStatus` 等）に従って複製している。
 * 片方を変えたらもう片方も変えること。
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
