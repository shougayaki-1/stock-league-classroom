/**
 * §7.5 defines `LessonPhase` as `{ id, type, progression, durationSeconds?,
 * requiredCompletionRatio?, displayConfig, inputConfig? }` but does not
 * define how phases connect to each other — §8.3's auto-check list
 * ("進行不能な分岐" / "終了条件がないフェーズ") implies phases form a graph,
 * not just a flat list, so this module adds `nextPhaseIds` (the phase IDs
 * this phase can advance to) as a Phase B addition, not part of the spec's
 * §7.5 shape. `displayConfig` doubles as the "生徒公開情報" (student-facing
 * info) required by this task's brief: §7.5 already designates it as the
 * spec's only student-display field, so requiring it to be set (rather than
 * inventing a second, parallel field) keeps this validator anchored to the
 * spec's actual shape.
 */
export interface LessonPhase {
  id: string
  type: 'INTRO' | 'INFORMATION' | 'PREDICTION' | 'DISCUSSION' | 'MARKET' | 'DECISION' | 'RESULT' | 'REFLECTION' | 'CUSTOM'
  progression: 'TIMED' | 'SUBMISSION_BASED' | 'TEACHER_CONTROLLED' | 'AUTOMATIC'
  durationSeconds?: number
  requiredCompletionRatio?: number
  /** Phase B addition (see module JSDoc): outgoing edges of the phase graph. */
  nextPhaseIds: string[]
  /** Student-facing display configuration (§7.5). Must be set — see module JSDoc. */
  displayConfig: unknown
  inputConfig?: unknown
}

/** Minimal lesson shape this validator needs — not the full `LessonContent`/`LessonTemplate` envelope (Phase A), since Phase B's phase graph does not exist in that schema yet. */
export interface LessonForStartValidation {
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  phases: LessonPhase[]
  /** Defaults to `phases[0].id` when omitted. */
  initialPhaseId?: string
}

export interface LessonStartProblem {
  severity: 'ERROR' | 'WARNING'
  code: string
  message?: string
}

const TERMINAL_PHASE_TYPES = new Set<LessonPhase['type']>(['RESULT', 'REFLECTION'])

/**
 * Provisional ceiling on total configured phase duration (sum of every
 * `durationSeconds` across the lesson's phases), in seconds. §12.34's
 * standard configurations range from a single 50-minute period up through
 * an explicit "複数時間" (multiple class periods) tier, so this cannot be
 * set to a single class period's length without flagging legitimate
 * multi-period lessons. 3 hours comfortably covers the documented "2時間"
 * tier with margin while still catching runaway/miskeyed duration values.
 * This is a placeholder — no numeric limit is specified anywhere in the
 * integrated spec — and should be tuned once real trial runs (試運転) of
 * multi-period lessons establish a better number (same "暫定値、試運転で調整"
 * treatment the Phase C plan applied to its own placeholder constants).
 */
const PROVISIONAL_MAX_TOTAL_DURATION_SECONDS = 3 * 60 * 60

/** BFS over `nextPhaseIds` from `startId`, returning every phase id reachable (including `startId` itself). */
const reachablePhaseIds = (phases: LessonPhase[], startId: string): Set<string> => {
  const byId = new Map(phases.map((phase) => [phase.id, phase]))
  const visited = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (visited.has(id)) continue
    visited.add(id)
    const phase = byId.get(id)
    if (!phase) continue
    for (const nextId of phase.nextPhaseIds) {
      if (!visited.has(nextId)) queue.push(nextId)
    }
  }
  return visited
}

/**
 * Pure, side-effect-free pre-flight check run before a `LessonRun` may enter
 * `RUNNING` (§8.3 "開始前テスト"). Returns the list of problems found; an
 * empty array means the lesson may start. Per §8.3, only genuinely blocking
 * conditions (contradictions, unreachable phases, missing required info) are
 * `ERROR`; softer concerns like an overlong lesson are `WARNING` and never
 * block starting.
 */
export const validateLessonForStart = (lesson: LessonForStartValidation): LessonStartProblem[] => {
  const problems: LessonStartProblem[] = []

  // 矛盾解消G: HOME_ECONOMICS lessons must never contain a MARKET phase —
  // the home-economics simulation (Phase D) has its own household-budget
  // mechanics, and a stock MARKET phase mixed into it would contradict that
  // subject's model entirely (docs/superpowers/plans/2026-08-05-phase-b-
  // common-lesson-platform-plan.md line 23).
  if (lesson.subject === 'HOME_ECONOMICS' && lesson.phases.some((phase) => phase.type === 'MARKET')) {
    problems.push({
      severity: 'ERROR',
      code: 'HOME_ECONOMICS_MARKET_FORBIDDEN',
      message: '家庭科の教材にMARKETフェーズを含めることはできません。',
    })
  }

  // Duplicate phase IDs make `nextPhaseIds` (and later, `currentPhaseId`)
  // ambiguous — checked before graph analysis so the reachability check
  // below is not misled by an id collision.
  const seenIds = new Set<string>()
  for (const phase of lesson.phases) {
    if (seenIds.has(phase.id)) {
      problems.push({
        severity: 'ERROR',
        code: 'DUPLICATE_PHASE_ID',
        message: `フェーズIDが重複しています: ${phase.id}`,
      })
    }
    seenIds.add(phase.id)
  }

  // 終了条件がないフェーズ / 進行不能な分岐 (§8.3): the phase graph, walked
  // from the initial phase, must be able to reach a RESULT/REFLECTION
  // (terminal) phase. An empty phase list or a graph with no terminal phase
  // at all also falls out of this same check (reachablePhaseIds returns an
  // empty/incomplete set).
  const initialPhaseId = lesson.initialPhaseId ?? lesson.phases[0]?.id
  const reachable = initialPhaseId ? reachablePhaseIds(lesson.phases, initialPhaseId) : new Set<string>()
  const reachesTerminal = lesson.phases.some((phase) => reachable.has(phase.id) && TERMINAL_PHASE_TYPES.has(phase.type))
  if (!reachesTerminal) {
    problems.push({
      severity: 'ERROR',
      code: 'NO_TERMINAL_PHASE',
      message: '結果・振り返りフェーズへ到達できません。',
    })
  }

  let totalDurationSeconds = 0
  for (const phase of lesson.phases) {
    if (phase.progression === 'TIMED') {
      if (typeof phase.durationSeconds !== 'number' || phase.durationSeconds <= 0) {
        problems.push({
          severity: 'ERROR',
          code: 'PHASE_DURATION_REQUIRED',
          message: `フェーズ「${phase.id}」はTIMED進行のため正のdurationSecondsが必要です。`,
        })
      }
    }
    if (phase.progression === 'SUBMISSION_BASED') {
      const ratio = phase.requiredCompletionRatio
      if (typeof ratio !== 'number' || ratio < 0 || ratio > 1) {
        problems.push({
          severity: 'ERROR',
          code: 'PHASE_COMPLETION_RATIO_INVALID',
          message: `フェーズ「${phase.id}」はSUBMISSION_BASED進行のためrequiredCompletionRatio(0〜1)が必要です。`,
        })
      }
    }
    if (phase.displayConfig === undefined || phase.displayConfig === null) {
      problems.push({
        severity: 'ERROR',
        code: 'MISSING_STUDENT_FACING_INFO',
        message: `フェーズ「${phase.id}」に生徒向け公開情報(displayConfig)が設定されていません。`,
      })
    }
    if (typeof phase.durationSeconds === 'number') {
      totalDurationSeconds += phase.durationSeconds
    }
  }

  // 想定時間超過 (§8.3) is explicitly listed among §8.3's checks that stay a
  // WARNING, never a blocking ERROR ("時間超過や偏った結果は警告に留める").
  if (totalDurationSeconds > PROVISIONAL_MAX_TOTAL_DURATION_SECONDS) {
    problems.push({
      severity: 'WARNING',
      code: 'DURATION_EXCEEDED',
      message: `想定合計時間(${totalDurationSeconds}秒)が暫定上限(${PROVISIONAL_MAX_TOTAL_DURATION_SECONDS}秒)を超えています。`,
    })
  }

  return problems
}
