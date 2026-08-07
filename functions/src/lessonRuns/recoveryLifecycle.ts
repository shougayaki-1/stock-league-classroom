import { appendLessonEventWithAdminSdk } from './appendLessonEvent'
import { writeCheckpointWithAdminSdk } from './checkpoint'
import { transitionPhaseWithAdminSdk } from './phases/transitionPhase'
import type { LessonRunStatus } from './phases/stateMachine'

/**
 * Pluggable "safe stop" extension point for the subject engines (Phase C's
 * market simulation, Phase D's household-economics engine). Task 8's brief
 * asks for exactly these three steps; Phase B has no subject engine yet, so
 * every method is satisfied here by `noopSubjectLifecycleAdapter` below.
 * Phase C/D inject their own implementation into `completeLesson` (and any
 * other lifecycle function that later needs it) once those engines exist.
 *
 * Relationship to Task 5's `TransitionPhaseDeps.stopActiveOperations`: that
 * hook already exists on `transitionPhase` and fires once, automatically,
 * right before any transition INTO REFLECTION. `completeLesson` below does
 * NOT go through that hook — it calls `stopNewOperations` /
 * `drainAcceptedOperations` itself, BEFORE ever calling `transitionPhase`,
 * and then calls `transitionPhase` with `stopActiveOperations` left
 * unset (achieved simply by using `transitionPhaseWithAdminSdk`, which
 * already leaves it unset — see that file's own production-wiring comment).
 * Two hooks calling the same "stop the market" side effect would either
 * double-invoke it or force `completeLesson` to thread a second layer of
 * dedup logic through `transitionPhase` for no benefit. Keeping exactly one
 * call site (`completeLesson`, via `SubjectLifecycleAdapter`) is simpler and
 * matches this task's brief, which spells out a 5-step sequence that
 * `completeLesson` — not `transitionPhase` — is responsible for driving.
 * `transitionPhase`'s own `stopActiveOperations` hook stays in place,
 * unused by this task, for any *other* future caller that transitions a run
 * into REFLECTION without going through `completeLesson`.
 */
export interface SubjectLifecycleAdapter {
  stopNewOperations(runId: string): Promise<void>
  drainAcceptedOperations(runId: string): Promise<void>
  buildSubjectSnapshot(runId: string): Promise<Record<string, unknown>>
}

/** Phase B default: every step succeeds immediately with no subject data. */
export const noopSubjectLifecycleAdapter: SubjectLifecycleAdapter = {
  stopNewOperations: async () => undefined,
  drainAcceptedOperations: async () => undefined,
  buildSubjectSnapshot: async () => ({}),
}

/** Shape shared by every lifecycle operation's injected status-transition call — a narrowed view of Task 5's `transitionPhase`/`transitionPhaseWithAdminSdk`. */
export interface LifecycleTransitionFn {
  (input: { lessonRunId: string; targetStatus: LessonRunStatus; reason: string; idempotencyKey: string }): Promise<{
    status: LessonRunStatus
    currentPhaseId: string | null
    deduplicated: boolean
  }>
}

/** Shape shared by every lifecycle operation's injected event-append call — a narrowed view of `appendLessonEventWithAdminSdk`. */
export interface LifecycleAppendEventFn {
  (input: {
    lessonRunId: string
    orgId: string
    type: string
    actorType: 'TEACHER'
    actorId: string
    payload: unknown
    idempotencyKey: string
  }): Promise<{ eventId: string; sequence: number; deduplicated: boolean }>
}

/** Shape shared by every lifecycle operation's injected checkpoint-write call — a narrowed view of `writeCheckpointWithAdminSdk`. */
export interface LifecycleWriteCheckpointFn {
  (input: {
    lessonRunId: string
    phaseId: string
    sequence: number
    snapshot: unknown
    createdBy: 'TEACHER'
    idempotencyKey: string
  }): Promise<{ checkpointId: string; deduplicated: boolean }>
}

// ---------------------------------------------------------------------------
// interruptLesson
// ---------------------------------------------------------------------------

export interface InterruptLessonDeps {
  transitionPhase: LifecycleTransitionFn
  appendEvent: LifecycleAppendEventFn
  actorId: string
}

export interface InterruptLessonInput {
  lessonRunId: string
  orgId: string
  reason: string
  interimResults: Record<string, unknown>
  resumePhaseId: string | null
  resumeCheckpointId: string | null
  idempotencyKey: string
}

export interface InterruptLessonResult {
  transition: { status: LessonRunStatus; currentPhaseId: string | null; deduplicated: boolean }
  eventId: string
}

/**
 * Interrupts a lesson (RUNNING/PAUSED → INTERRUPTED, already permitted by
 * Task 5's `canTransitionRun` table). The status transition itself is
 * delegated entirely to Task 5's `transitionPhase` — this function does not
 * re-implement any state-machine logic. Interrupt-specific data (reason,
 * interim results, and where to resume from) does not fit
 * `transitionPhase`'s `LESSON_STATUS_CHANGED` payload (which only carries
 * `previousStatus`/`newStatus`/`reason`), so it is recorded as a *separate*
 * `LESSON_INTERRUPTED` event, appended AFTER the transition's own Firestore
 * transaction has already committed — the same "separate, sequential,
 * non-nested transaction" shape `transitionPhase` itself uses for
 * `writeCheckpoint` (see that file's JSDoc), for the same reason:
 * `appendLessonEventWithAdminSdk` opens its own self-contained
 * `db.runTransaction()` and cannot be nested inside another one.
 */
export const interruptLesson = async (
  deps: InterruptLessonDeps,
  input: InterruptLessonInput,
): Promise<InterruptLessonResult> => {
  const transition = await deps.transitionPhase({
    lessonRunId: input.lessonRunId,
    targetStatus: 'INTERRUPTED',
    reason: input.reason,
    idempotencyKey: `transition:${input.idempotencyKey}`,
  })
  const event = await deps.appendEvent({
    lessonRunId: input.lessonRunId,
    orgId: input.orgId,
    type: 'LESSON_INTERRUPTED',
    actorType: 'TEACHER',
    actorId: deps.actorId,
    payload: {
      reason: input.reason,
      interimResults: input.interimResults,
      resumePhaseId: input.resumePhaseId,
      resumeCheckpointId: input.resumeCheckpointId,
    },
    idempotencyKey: `interrupted:${input.idempotencyKey}`,
  })
  return { transition, eventId: event.eventId }
}

// ---------------------------------------------------------------------------
// resumeLesson
// ---------------------------------------------------------------------------

export interface ResumeLessonDeps {
  transitionPhase: LifecycleTransitionFn
  actorId: string
}

export interface ResumeLessonInput {
  lessonRunId: string
  reason: string
  idempotencyKey: string
}

/**
 * Design judgment call (brief left this open — see this task's dispatch
 * prompt): "教師が接続・チームを再確認してから RUNNING に進める" is read as
 * a two-step, two-Callable flow, NOT one function that itself inspects
 * connection/team state:
 *
 *  1. `resumeLesson` (this function): INTERRUPTED → WAITING. WAITING is
 *     already the lesson's own "students are gathering, not yet running"
 *     status (§8.2) — putting an interrupted run back into WAITING re-uses
 *     that exact meaning and re-exposes the run to whatever
 *     connection/roster UI already exists for a normal pre-start WAITING
 *     lesson (Task 3/4's join/team-assignment flows), rather than this task
 *     inventing a parallel "resume readiness" concept from scratch.
 *  2. Progressing WAITING → RUNNING afterward is *not* new code: Task 5's
 *     `canTransitionRun` table already allows WAITING → RUNNING, and the
 *     existing `transitionPhaseCallable` (phases/onCall.ts) already exposes
 *     it. Once the teacher is satisfied (having used the existing
 *     roster/connection UI), they call that same, already-shipped Callable
 *     with `targetStatus: 'RUNNING'` — no new lifecycle function is needed
 *     for this half of the flow.
 *
 * This function therefore only ever performs the first step.
 */
export const resumeLesson = async (
  deps: ResumeLessonDeps,
  input: ResumeLessonInput,
): Promise<{ status: LessonRunStatus; currentPhaseId: string | null; deduplicated: boolean }> => {
  return deps.transitionPhase({
    lessonRunId: input.lessonRunId,
    targetStatus: 'WAITING',
    reason: input.reason,
    idempotencyKey: `transition:${input.idempotencyKey}`,
  })
}

// ---------------------------------------------------------------------------
// completeLesson
// ---------------------------------------------------------------------------

export interface CompleteLessonDeps {
  /** Defaults to `noopSubjectLifecycleAdapter` — Phase C/D inject their own once their engines exist. */
  adapter?: SubjectLifecycleAdapter
  writeCheckpoint: LifecycleWriteCheckpointFn
  transitionPhase: LifecycleTransitionFn
  actorId: string
}

export interface CompleteLessonInput {
  lessonRunId: string
  reason: string
  idempotencyKey: string
  /** Label recorded on the final-results checkpoint; the concrete final-results phase concept belongs to Phase C/D. */
  finalPhaseId?: string
}

export interface CompleteLessonResult {
  finalResults: Record<string, unknown>
  checkpointId: string
  transition: { status: LessonRunStatus; currentPhaseId: string | null; deduplicated: boolean }
}

/**
 * Normal end-of-lesson flow, driving the brief's 5-step sequence itself:
 * `stopNewOperations → drainAcceptedOperations → buildFinalResults →
 * writeCheckpoint → REFLECTION`. See `SubjectLifecycleAdapter`'s own JSDoc
 * above for why this function — not `transitionPhase`'s
 * `stopActiveOperations` hook — owns steps 1-2.
 *
 * `buildFinalResults` (step 3) is intentionally generic in Phase B: it is
 * `SubjectLifecycleAdapter.buildSubjectSnapshot`'s return value, stored
 * as-is. What that snapshot actually contains (aggregated
 * portfolio/household results) is Phase C/D's concern.
 *
 * The explicit `writeCheckpoint` call (step 4) uses `finalPhaseId` (default
 * `'FINAL_RESULTS'`) and a synthetic `sequence: -1` rather than a real
 * event sequence number, because this checkpoint is not tied to any single
 * `LessonEvent` — it captures the final subject snapshot, a concept that
 * does not otherwise have a natural phase/sequence pair yet in Phase B.
 * `-1` is chosen specifically so it can never collide with a real
 * (non-negative) event sequence.
 *
 * `writeCheckpoint` is a *separate, self-contained* transaction
 * (`writeCheckpointWithAdminSdk` opens its own `db.runTransaction()`, same
 * constraint documented in checkpoint.ts and transitionPhase.ts), so it
 * cannot be nested inside `transitionPhase`'s own transaction — it must run
 * as an independent call before `transitionPhase` is invoked, exactly the
 * order the brief specifies.
 *
 * Step 5 (`transitionPhase` with `targetStatus: 'REFLECTION'`) is Task 5's
 * existing `transitionPhase`, called last and unmodified. Because
 * `transitionPhase` treats REFLECTION as a "major phase boundary"
 * (transitionPhase.ts's `isMajorPhaseBoundary`), it *also* writes its own
 * checkpoint internally after its transaction commits — that is expected
 * and is a different, redundant-by-design checkpoint (Task 5's own
 * placeholder `{status, currentPhaseId}` snapshot) from this function's
 * explicit final-results checkpoint above; the two use different
 * `idempotencyKey`s (`final:...` vs `transition:...`) so they never collide
 * or dedupe against each other. `stopActiveOperations` is left unset for
 * this call — see `SubjectLifecycleAdapter`'s JSDoc for why.
 */
export const completeLesson = async (
  deps: CompleteLessonDeps,
  input: CompleteLessonInput,
): Promise<CompleteLessonResult> => {
  const adapter = deps.adapter ?? noopSubjectLifecycleAdapter
  await adapter.stopNewOperations(input.lessonRunId)
  await adapter.drainAcceptedOperations(input.lessonRunId)
  const finalResults = await adapter.buildSubjectSnapshot(input.lessonRunId)
  const checkpoint = await deps.writeCheckpoint({
    lessonRunId: input.lessonRunId,
    phaseId: input.finalPhaseId ?? 'FINAL_RESULTS',
    sequence: -1,
    snapshot: finalResults,
    createdBy: 'TEACHER',
    idempotencyKey: `final:${input.idempotencyKey}`,
  })
  const transition = await deps.transitionPhase({
    lessonRunId: input.lessonRunId,
    targetStatus: 'REFLECTION',
    reason: input.reason,
    idempotencyKey: `transition:${input.idempotencyKey}`,
  })
  return { finalResults, checkpointId: checkpoint.checkpointId, transition }
}

// ---------------------------------------------------------------------------
// abortLesson
// ---------------------------------------------------------------------------

export interface AbortLessonDeps {
  transitionPhase: LifecycleTransitionFn
  appendEvent: LifecycleAppendEventFn
  actorId: string
}

export interface AbortLessonInput {
  lessonRunId: string
  orgId: string
  reason: string
  /** Phases already completed at the moment of abort — frozen as-is into the ABORTED event's `evaluatedPhaseIds`; anything not in this list is excluded from evaluation. */
  completedPhaseIds: string[]
  idempotencyKey: string
}

export interface AbortLessonResult {
  transition: { status: LessonRunStatus; currentPhaseId: string | null; deduplicated: boolean }
  eventId: string
}

/**
 * Aborts a lesson from any actively-running status (Task 5's
 * `canTransitionRun` already allows WAITING/RUNNING/PAUSED/INTERRUPTED →
 * ABORTED — this function does not re-derive that rule). `completedPhaseIds`
 * is caller-supplied (the caller already knows, from the run's own
 * `PHASE_CHANGED` event history, which phases were actually completed) and
 * is recorded verbatim as `evaluatedPhaseIds` on a `LESSON_ABORTED` event —
 * "未実施フェーズを評価対象外にする" (brief) means whatever phase was in
 * progress at abort time, and anything after it, is simply never added to
 * this list, so grading downstream only ever sees the frozen, already-
 * completed set.
 */
export const abortLesson = async (
  deps: AbortLessonDeps,
  input: AbortLessonInput,
): Promise<AbortLessonResult> => {
  const transition = await deps.transitionPhase({
    lessonRunId: input.lessonRunId,
    targetStatus: 'ABORTED',
    reason: input.reason,
    idempotencyKey: `transition:${input.idempotencyKey}`,
  })
  const event = await deps.appendEvent({
    lessonRunId: input.lessonRunId,
    orgId: input.orgId,
    type: 'LESSON_ABORTED',
    actorType: 'TEACHER',
    actorId: deps.actorId,
    payload: { reason: input.reason, evaluatedPhaseIds: input.completedPhaseIds },
    idempotencyKey: `aborted:${input.idempotencyKey}`,
  })
  return { transition, eventId: event.eventId }
}

// ---------------------------------------------------------------------------
// 復旧世代: 古い世代の非同期処理を無視するガード
// ---------------------------------------------------------------------------

/**
 * General-purpose guard for the brief's "古い世代の非同期処理を無視する"
 * requirement. Phase B has no concrete async subject-engine task to guard
 * yet (that is Phase C's market engine) — this is the reusable primitive
 * such a task's dispatcher is expected to call: capture
 * `LessonRun.restoreGeneration` at dispatch time, then check it again
 * immediately before applying the task's result; if the run has since been
 * restored to a newer generation, skip applying it. See this file's test
 * for a worked example.
 */
export const shouldSkipStaleAsyncTask = (
  taskRestoreGeneration: number,
  currentRestoreGeneration: number,
): boolean => taskRestoreGeneration !== currentRestoreGeneration

// ---------------------------------------------------------------------------
// Production wiring (Firebase Admin SDK)
// ---------------------------------------------------------------------------

/** Binds `transitionPhaseWithAdminSdk` with the real caller's actorId for one lifecycle call. `stopActiveOperations` is left unset — see `SubjectLifecycleAdapter`'s JSDoc. */
const bindTransitionPhase = (actorId: string): LifecycleTransitionFn => (input) =>
  transitionPhaseWithAdminSdk({ ...input, actorId, actorType: 'TEACHER' })

const bindAppendEvent = (): LifecycleAppendEventFn => (input) => appendLessonEventWithAdminSdk(input)

export const interruptLessonWithAdminSdk = (
  input: InterruptLessonInput & { actorId: string },
): Promise<InterruptLessonResult> => {
  const { actorId, ...rest } = input
  return interruptLesson(
    { transitionPhase: bindTransitionPhase(actorId), appendEvent: bindAppendEvent(), actorId },
    rest,
  )
}

export const resumeLessonWithAdminSdk = (
  input: ResumeLessonInput & { actorId: string },
): ReturnType<typeof resumeLesson> => {
  const { actorId, ...rest } = input
  return resumeLesson({ transitionPhase: bindTransitionPhase(actorId), actorId }, rest)
}

export const completeLessonWithAdminSdk = (
  input: CompleteLessonInput & { actorId: string; adapter?: SubjectLifecycleAdapter },
): Promise<CompleteLessonResult> => {
  const { actorId, adapter, ...rest } = input
  return completeLesson(
    { adapter, writeCheckpoint: writeCheckpointWithAdminSdk, transitionPhase: bindTransitionPhase(actorId), actorId },
    rest,
  )
}

export const abortLessonWithAdminSdk = (
  input: AbortLessonInput & { actorId: string },
): Promise<AbortLessonResult> => {
  const { actorId, ...rest } = input
  return abortLesson(
    { transitionPhase: bindTransitionPhase(actorId), appendEvent: bindAppendEvent(), actorId },
    rest,
  )
}
