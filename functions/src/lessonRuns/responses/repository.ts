import type { ParticipantId, TeamId } from '@stock-league/lesson-runtime-types'
// Type-only: this module only needs LessonInputValue's shape, never its
// runtime exports (e.g. validateLessonInput), so `import type` (erased by
// tsc's commonjs emit) is all that's required here regardless of whether
// `@stock-league/lesson-inputs` ships a compiled `dist/` — which it now
// does, at functions/packages/lesson-inputs (moved there so its
// `file:packages/lesson-inputs` dependency resolves inside the functions
// deploy package, same as @stock-league/lesson-runtime-types).
import type { LessonInputValue } from '@stock-league/lesson-inputs'

/**
 * Minimal JSON value type for `LessonResponse.contextSnapshot`. Not sourced
 * from an existing shared module — none defines it yet (checked
 * functions/src, packages/, src/ before adding this).
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type LessonResponseStatus = 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'CONFIRMED'

/**
 * Firestore system of record for a single response to a single lesson input,
 * stored at `lessonRuns/{lessonRunId}/responses/{id}`. Exactly one of
 * `participantId` (§10 `responseScope: 'INDIVIDUAL'`) or `teamId`
 * (`responseScope: 'TEAM'`) is set, matching Task 6's
 * `@stock-league/lesson-inputs` `LessonInputField.responseScope` axis.
 *
 * `approvals` is this task's aggregation-state extension beyond the brief's
 * literal type: it records which team members have registered an APPROVE
 * decision for the *current* PROPOSED round (see decideProposal.ts for the
 * REPRESENTATIVE/ALL/QUORUM aggregation this drives). It is reset to `[]`
 * whenever a fresh proposal is submitted (submitProposal.ts), since a new
 * value invalidates any prior round's approvals.
 */
export interface LessonResponse {
  id: string
  lessonRunId: string
  orgId: string
  participantId?: ParticipantId
  teamId?: TeamId
  phaseId: string
  inputId: string
  value: LessonInputValue
  status: LessonResponseStatus
  revision: number
  rationaleInformationIds: string[]
  approvals: ParticipantId[]
  /**
   * Phase C extension point (Task 5's `stopActiveOperations` pluggable-deps
   * pattern): Phase B never populates this beyond `{}`; a future subject
   * adapter (e.g. a market adapter attaching the reference price at
   * proposal time) can inject `resolveContextSnapshot` into submitProposal's
   * deps to populate it. The allow-listing of *which* keys a given lesson
   * subject may write is that adapter's concern, not this module's.
   */
  contextSnapshot: Record<string, JsonValue>
  confirmedAt?: unknown
}

/**
 * Deterministic response doc id, scoped by (individual participantId or
 * team id) + phaseId + inputId. Lets every Callable in this task compute the
 * doc path directly from its input without a lookup, and makes repeated
 * saveResponseDraft calls for the same input naturally target the same doc.
 */
export const deriveResponseId = (scopeId: string, phaseId: string, inputId: string): string =>
  `${scopeId}_${phaseId}_${inputId}`
