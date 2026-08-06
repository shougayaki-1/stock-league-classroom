/**
 * Fields safe to send to every participant in a lessonRun. Phase A defines
 * only the envelope; Phase B/C will add phase-specific display fields.
 *
 * INVARIANT (spec §26-1): this type must never gain a field that reveals
 * future prices, non-public coefficients, or a random seed. If a field here
 * would let a participant compute or look up such a value, it belongs in
 * LessonRunPrivateState instead — never as an optional/hidden field on this
 * type, because RTDB has no field-level rules: the whole node's `.read`
 * grant applies to everything under it.
 */
export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
}

/**
 * Fields that must never reach a participant: future price plans, seeds,
 * non-public coefficients (spec §26-1). This type's data must live at a
 * SEPARATE top-level RTDB path from LessonRunPublicState — see
 * database.rules.json's `lessonRunPrivate` node. Do not nest this under
 * `lessonRunPublic/{lessonRunId}`; RTDB's read cascade means a broad grant
 * on an ancestor cannot be revoked by a `.read: false` on a descendant, so
 * nesting private data under a publicly-readable node reintroduces exactly
 * the vulnerability this split exists to close (see the "旧実装の廃止範囲"
 * section of this plan and Phase 0's findings on `prices/{id}/runtime` and
 * `companies/{id}/phases`).
 */
export interface LessonRunPrivateState {
  randomSeed: string
  restoreGeneration: number
  updatedAtMillis: number
}
