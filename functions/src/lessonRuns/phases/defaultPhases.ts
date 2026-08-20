import type { LessonPhase } from './validation'

export interface DefaultPhaseGraph {
  phases: LessonPhase[]
  initialPhaseId: string
}

/**
 * Minimal, fixed 4-phase graph (intro -> subject-specific middle phase ->
 * result -> reflection), generated because no template-authoring UI in
 * this codebase produces a `phases` field yet (LessonContent has none) —
 * without this, `validateLessonForStart` always fails NO_TERMINAL_PHASE
 * and no lesson could ever start. Every phase uses TEACHER_CONTROLLED
 * progression so the teacher advances manually from Control Room, avoiding
 * the TIMED/SUBMISSION_BASED requirements (durationSeconds/
 * requiredCompletionRatio) a template author has no UI to configure.
 *
 * This is a deliberate placeholder for the real per-template phase graph a
 * future authoring-UI task would let teachers define — do not extend this
 * with more phase types/branches; if richer authoring is needed, build the
 * editor and stop calling this function for templates that have their own
 * `phases`.
 *
 * `coreActivityMinutes` を渡すと、中核フェーズ（社会科は market、家庭科は
 * decision）だけに `durationSeconds` を設定する。progression は
 * `TEACHER_CONTROLLED` のまま変えない — `TIMED` は validation.ts が検証する
 * だけで、満了時にフェーズを進めるスケジューラはこのコードベースに存在
 * しないため、`TIMED` にすると起きない自動進行を約束することになる。設定
 * された時間はあくまで教師と生徒に見せる目安であり、超過しても何も起きない。
 */
export const buildDefaultPhases = (
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS',
  coreActivityMinutes?: number,
): DefaultPhaseGraph => {
  const coreDuration = typeof coreActivityMinutes === 'number' && coreActivityMinutes > 0
    ? { durationSeconds: coreActivityMinutes * 60 }
    : {}

  const middlePhase: LessonPhase = subject === 'SOCIAL_STUDIES'
    ? { id: 'market', type: 'MARKET', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['result'], displayConfig: { label: '取引' }, ...coreDuration }
    : { id: 'decision', type: 'DECISION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['result'], displayConfig: { label: '意思決定' }, ...coreDuration }

  const phases: LessonPhase[] = [
    { id: 'intro', type: 'INTRO', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [middlePhase.id], displayConfig: { label: '導入' } },
    middlePhase,
    { id: 'result', type: 'RESULT', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['reflection'], displayConfig: { label: '結果' } },
    { id: 'reflection', type: 'REFLECTION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [], displayConfig: { label: '振り返り' } },
  ]

  return { phases, initialPhaseId: 'intro' }
}
