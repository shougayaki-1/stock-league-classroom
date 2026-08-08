import { randomUUID } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

interface FirestoreTransaction {
  get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  set: (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => void
}

export interface DuplicateLessonTemplateDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<DuplicateLessonTemplateResult>) => Promise<DuplicateLessonTemplateResult> }
  randomUUID: () => string
  now?: () => unknown
}

/**
 * Schedule-sensitive settings that must be reset (not silently carried over)
 * when duplicating a lesson template — dates, publish times, time limits,
 * class assignment, absence handling, notifications — per the Task 16
 * brief. As of Phase A/B, `LessonContent` (src/lib/lessonTemplates/types.ts)
 * carries none of these fields yet; they belong to Phase C/D's authoring
 * content (rounds, market config, assessment rubric, etc.). This type is
 * therefore an intentionally empty placeholder mirroring the same
 * "minimal now, extend later" pattern `LessonContent.schemaVersion` already
 * establishes. When Phase C/D adds such fields to `LessonContent`, add the
 * matching fields here and extend `duplicateLessonTemplate`'s carry-over/
 * reset/confirmedOverrides classification below to match — do not invent
 * fields ahead of that work.
 */
export type ScheduleSensitiveSettings = Record<string, never>

export interface DuplicateLessonTemplateInput {
  sourceTemplateId: string
  sourceVersionId: string
  targetOrgId: string
  /** Resolved server-side from the caller's auth token — never client input for authorization purposes. */
  uid: string
  /**
   * Explicit, per-field opt-in copy of schedule-sensitive settings (see
   * ScheduleSensitiveSettings). Currently always `{}` in practice because
   * LessonContent has no such fields yet; kept in the input shape so the
   * Callable contract does not need to change again once Phase C/D adds them.
   */
  confirmedOverrides: Partial<ScheduleSensitiveSettings>
  idempotencyKey: string
}

export interface DuplicateLessonTemplateResult {
  templateId: string
  /** True when this call replayed an already-duplicated idempotency key rather than creating a new template. */
  alreadyDuplicated: boolean
}

/**
 * Duplicates an immutable LessonVersion's content into a brand-new
 * LessonTemplate owned by the target org/caller — never the source
 * template's in-progress draft, so unpublished edits are never leaked into
 * the copy. The new template starts life exactly like a freshly authored
 * one (status DRAFT, visibility PRIVATE, no published version) with
 * sourceTemplateId/sourceVersionId recorded for lineage.
 *
 * Deep-clones the source content (via structuredClone) so the new draft
 * never shares object references with the immutable source version —
 * mutating one can never affect the other.
 *
 * Participants, teams, decisions/trades, run state, standings, and teacher
 * interventions are never part of LessonTemplate/LessonVersion in the first
 * place (they live under lessonRuns), so there is nothing here that could
 * copy them — duplication is structurally scoped to template content only.
 *
 * Idempotent by (targetOrgId, idempotencyKey), all reads before all writes
 * in a single transaction, matching publishLessonVersion's pattern.
 */
export const duplicateLessonTemplate = (deps: DuplicateLessonTemplateDeps, input: DuplicateLessonTemplateInput): Promise<DuplicateLessonTemplateResult> => {
  const idempotencyPath = `lessonTemplateDuplicateIdempotency/${idempotencyDocumentId(input.targetOrgId, input.idempotencyKey)}`
  // uid is included so two different teachers cannot reuse the same
  // idempotency key against the same source/target and replay each other's
  // result (mirrors publishLessonVersion's Finding 4 fix).
  const requestDigest = computeRequestDigest({
    sourceTemplateId: input.sourceTemplateId,
    sourceVersionId: input.sourceVersionId,
    confirmedOverrides: input.confirmedOverrides,
    createdByUid: input.uid,
  })
  const sourceVersionPath = `lessonTemplates/${input.sourceTemplateId}/versions/${input.sourceVersionId}`
  const now = deps.now ? deps.now() : new Date().toISOString()

  return deps.firestore.runTransaction(async (tx) => {
    const idempotencySnap = await tx.get(idempotencyPath)
    if (idempotencySnap.exists) {
      if (idempotencySnap.data?.requestDigest !== requestDigest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return { templateId: idempotencySnap.data?.templateId as string, alreadyDuplicated: true }
    }

    const sourceVersionSnap = await tx.get(sourceVersionPath)
    if (!sourceVersionSnap.exists || !sourceVersionSnap.data) {
      throw new Error('Source lesson version not found')
    }
    if (sourceVersionSnap.data.templateId !== input.sourceTemplateId) {
      throw new Error('Source lesson version does not belong to the expected template')
    }

    // ScheduleSensitiveSettings is currently an empty placeholder (see its
    // JSDoc above), so there is nothing in `confirmedOverrides` to apply to
    // the draft yet — the clone below already carries every field
    // LessonContent currently has. Once ScheduleSensitiveSettings gains
    // real fields, apply input.confirmedOverrides onto `draft` here instead
    // of leaving those fields untouched/reset.
    const draft = structuredClone(sourceVersionSnap.data.content as Record<string, unknown>)

    const templateId = deps.randomUUID()
    const templatePath = `lessonTemplates/${templateId}`

    tx.set(templatePath, {
      id: templateId,
      orgId: input.targetOrgId,
      createdByUid: input.uid,
      draft,
      currentPublishedVersionId: null,
      status: 'DRAFT',
      visibility: 'PRIVATE',
      sourceTemplateId: input.sourceTemplateId,
      sourceVersionId: input.sourceVersionId,
      createdAt: now,
      updatedAt: now,
    })
    tx.set(idempotencyPath, { requestDigest, templateId, createdAt: now })

    return { templateId, alreadyDuplicated: false }
  })
}

/** Production wiring: Firestore Admin SDK transaction + Node's crypto. */
export const duplicateLessonTemplateWithAdminSdk = (input: DuplicateLessonTemplateInput): Promise<DuplicateLessonTemplateResult> => {
  const db = getFirestore()
  return duplicateLessonTemplate({
    firestore: {
      runTransaction: (fn) => db.runTransaction(async (tx) => fn({
        get: async (path) => {
          const snap = await tx.get(db.doc(path))
          return { exists: snap.exists, data: snap.data() }
        },
        set: (path, data, options) => { tx.set(db.doc(path), data, options ?? { merge: false }) },
      })),
    },
    randomUUID: () => randomUUID(),
    now: () => FieldValue.serverTimestamp(),
  }, input)
}
