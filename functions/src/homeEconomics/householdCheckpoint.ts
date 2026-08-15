import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import type { HouseholdFirestoreDeps, HouseholdState } from '../lessonRuns/households/repository'
import { toHouseholdStateTeamView, type HouseholdStateTeamView } from './realtimeProjection'
import { resolveVisibleConcepts, type ConceptCategory } from './goalPackage'
import { findActiveBulkSettlementLeaseWithAdminSdk } from './bulkSettlementOperation'
import { ensureCommonConditionsHouseholdStateWithAdminSdk } from './commonConditionsHousehold'
import type { AdvancedHouseholdCourseFormat, HouseholdAssignmentEntry } from './householdAssignment'

export interface HouseholdCheckpointSnapshotV2 {
  schemaVersion: 2
  scope: 'ALL_HOUSEHOLDS'
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  createdAtServerMillis: number
  createdByUid: string
  expectedRoundIndex: number | null
  householdIds: string[]
  households: HouseholdState[]
  teamViews: Record<string, HouseholdStateTeamView>
}

export interface HouseholdCheckpointManifest {
  checkpointId: string
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  expectedRoundIndex: number | null
  createdAtServerMillis: number
  createdByUid: string
  restoreGeneration: number
  /**
   * Which snapshot codec produced this checkpoint. `2` = Common-only
   * `HouseholdCheckpointSnapshotV2` (one household per team, `teamViews`
   * keyed by `teamId`). `3` = advanced-format `HouseholdCheckpointSnapshotV3`
   * (one-or-more runtime households per team, `teamViews` keyed by `teamId`
   * with a nested `households` map — see `HouseholdCheckpointTeamViewV3`).
   * A single LessonRun's checkpoint history is always one or the other for
   * its whole lifetime (Common lessons never produce v3, advanced lessons
   * never produce v2) — this field exists so a manifest list consumer can
   * tell which shape a given `checkpointId`'s full snapshot will be without
   * fetching it.
   */
  schemaVersion: 2 | 3
}

export const isHouseholdCheckpointSnapshotV2 = (snapshot: unknown): snapshot is HouseholdCheckpointSnapshotV2 => {
  if (typeof snapshot !== 'object' || snapshot === null) return false
  const data = snapshot as Record<string, unknown>
  return (
    data.schemaVersion === 2 &&
    data.scope === 'ALL_HOUSEHOLDS' &&
    typeof data.label === 'string' &&
    typeof data.createdAtServerMillis === 'number' &&
    typeof data.createdByUid === 'string' &&
    Array.isArray(data.householdIds) &&
    Array.isArray(data.households) &&
    typeof data.teamViews === 'object' &&
    data.teamViews !== null
  )
}

export interface BuildHouseholdCheckpointSnapshotV2Input {
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  createdAtServerMillis: number
  createdByUid: string
  expectedRoundIndex: number | null
  householdIds: string[]
  households: HouseholdState[]
  teamViews: Record<string, HouseholdStateTeamView>
}

export const buildHouseholdCheckpointSnapshotV2 = (
  input: BuildHouseholdCheckpointSnapshotV2Input,
): HouseholdCheckpointSnapshotV2 => ({
  schemaVersion: 2,
  scope: 'ALL_HOUSEHOLDS',
  kind: input.kind,
  label: input.label,
  createdAtServerMillis: input.createdAtServerMillis,
  createdByUid: input.createdByUid,
  expectedRoundIndex: input.expectedRoundIndex,
  householdIds: [...input.householdIds].sort(),
  households: input.households.map((h) => ({ ...h })),
  teamViews: Object.fromEntries(
    Object.entries(input.teamViews).map(([id, view]) => [id, { ...view }]),
  ),
})

/**
 * Advanced-format (ROLE_VARIANT / STAGE_SPLIT / MULTI_PERSON_PER_TEAM)
 * per-team checkpoint view. Unlike v2's `Record<teamId, HouseholdStateTeamView>`
 * (exactly one household per team — Common's `.household` RTDB shape), a
 * team can host MORE THAN ONE runtime household under the 3 advanced
 * formats (MULTI_PERSON_PER_TEAM always; ROLE_VARIANT/STAGE_SPLIT can via
 * MANUAL entry edits), so this nests a `householdId -> view` map plus a
 * stable, sorted `householdOrder` instead of a single bare view — see
 * `buildHouseholdCheckpointSnapshotV3` below for how per-household views are
 * grouped by `teamId` without any sibling overwriting another.
 */
export interface HouseholdCheckpointTeamViewV3 {
  households: Record<string, HouseholdStateTeamView>
  householdOrder: string[]
}

export interface HouseholdCheckpointSnapshotV3 {
  schemaVersion: 3
  scope: 'ALL_HOUSEHOLDS'
  courseFormat: AdvancedHouseholdCourseFormat
  assignmentRevision: number
  restoreGeneration: number
  expectedRoundIndex: number
  householdIds: string[]
  householdStates: HouseholdState[]
  teamViews: Record<string, HouseholdCheckpointTeamViewV3>
  createdAtServerMillis: number
}

export const isHouseholdCheckpointSnapshotV3 = (snapshot: unknown): snapshot is HouseholdCheckpointSnapshotV3 => {
  if (typeof snapshot !== 'object' || snapshot === null) return false
  const data = snapshot as Record<string, unknown>
  return (
    data.schemaVersion === 3 &&
    data.scope === 'ALL_HOUSEHOLDS' &&
    typeof data.courseFormat === 'string' &&
    typeof data.assignmentRevision === 'number' &&
    typeof data.restoreGeneration === 'number' &&
    typeof data.expectedRoundIndex === 'number' &&
    Array.isArray(data.householdIds) &&
    Array.isArray(data.householdStates) &&
    typeof data.teamViews === 'object' &&
    data.teamViews !== null &&
    typeof data.createdAtServerMillis === 'number'
  )
}

export interface BuildHouseholdCheckpointSnapshotV3Input {
  courseFormat: AdvancedHouseholdCourseFormat
  assignmentRevision: number
  restoreGeneration: number
  expectedRoundIndex: number
  householdIds: string[]
  /**
   * Every runtime household to include, exactly once each — the caller
   * (`writeHouseholdCheckpointV3`) is responsible for having read exactly
   * one `HouseholdState` per id in `householdIds`, sorted, no duplicates.
   */
  householdStates: HouseholdState[]
  visibleConcepts: ConceptCategory[]
  createdAtServerMillis: number
}

/**
 * Builds the v3 snapshot DIRECTLY from the household states the caller
 * already read inside its own Firestore transaction (see
 * `writeHouseholdCheckpointV3`'s doc comment for why this does NOT read an
 * RTDB team projection the way v2's `readTeamView` does): each
 * `HouseholdState` is projected via `toHouseholdStateTeamView` (same
 * allow-list projection v2 uses) with empty `eventDisclosures`/
 * `shortfallOptions` — those are ephemeral per-round UI hints computed by
 * `processRound`, not part of `HouseholdState` itself, and reconstructing
 * them here would mean re-running settlement business logic inside a
 * checkpoint writer; a restored household simply shows no stale
 * disclosures/options until its own next round recomputes them, the same
 * fallback v2's `readTeamViewWithAdminSdk` already uses for a fresh
 * (`roundIndex === 0`) household with no RTDB projection yet.
 *
 * Views are grouped by `HouseholdState.teamId` into
 * `HouseholdCheckpointTeamViewV3.households[householdId]` — keyed by the
 * RUNTIME `householdId`, never by `teamId` alone — so two+ households
 * sharing one team (MULTI_PERSON_PER_TEAM, or a ROLE_VARIANT/STAGE_SPLIT
 * team edited to hold more than one) each get their own entry instead of
 * overwriting each other, which is exactly the bug the Task 6 placeholder
 * writer's doc comment flagged in `writeHouseholdCheckpointV2`'s
 * `teamId`-keyed `teamViews`.
 */
export const buildHouseholdCheckpointSnapshotV3 = (
  input: BuildHouseholdCheckpointSnapshotV3Input,
): HouseholdCheckpointSnapshotV3 => {
  const teamViews: Record<string, HouseholdCheckpointTeamViewV3> = {}
  for (const household of input.householdStates) {
    const view = toHouseholdStateTeamView(household, input.visibleConcepts, [], [])
    const existing = teamViews[household.teamId] ?? { households: {}, householdOrder: [] }
    existing.households[household.householdId] = view
    if (!existing.householdOrder.includes(household.householdId)) {
      existing.householdOrder = [...existing.householdOrder, household.householdId].sort()
    }
    teamViews[household.teamId] = existing
  }

  return {
    schemaVersion: 3,
    scope: 'ALL_HOUSEHOLDS',
    courseFormat: input.courseFormat,
    assignmentRevision: input.assignmentRevision,
    restoreGeneration: input.restoreGeneration,
    expectedRoundIndex: input.expectedRoundIndex,
    householdIds: [...input.householdIds].sort(),
    householdStates: input.householdStates.map((h) => ({ ...h })),
    teamViews,
    createdAtServerMillis: input.createdAtServerMillis,
  }
}

export const listHouseholdCheckpointManifests = (
  docs: Array<{ id: string; data: Record<string, unknown> }>,
): HouseholdCheckpointManifest[] => {
  const manifests: HouseholdCheckpointManifest[] = []
  for (const doc of docs) {
    const snapshot = doc.data.snapshot
    if (isHouseholdCheckpointSnapshotV2(snapshot) && snapshot.scope === 'ALL_HOUSEHOLDS') {
      manifests.push({
        checkpointId: doc.id,
        kind: snapshot.kind,
        label: snapshot.label,
        expectedRoundIndex: snapshot.expectedRoundIndex,
        createdAtServerMillis: snapshot.createdAtServerMillis,
        createdByUid: snapshot.createdByUid,
        restoreGeneration: typeof doc.data.restoreGeneration === 'number' ? doc.data.restoreGeneration : 0,
        schemaVersion: 2,
      })
      continue
    }
    if (isHouseholdCheckpointSnapshotV3(snapshot) && snapshot.scope === 'ALL_HOUSEHOLDS') {
      // v3's snapshot itself carries no `kind`/`label`/`createdByUid` (see
      // `HouseholdCheckpointSnapshotV3`'s interface) — those live on the
      // enclosing checkpoint DOCUMENT instead (`writeHouseholdCheckpointV3`'s
      // `checkpointDoc`), so read them from `doc.data` here rather than the
      // snapshot.
      manifests.push({
        checkpointId: doc.id,
        kind: (typeof doc.data.kind === 'string' ? doc.data.kind : 'MANUAL') as HouseholdCheckpointManifest['kind'],
        label: typeof doc.data.label === 'string' ? doc.data.label : '',
        expectedRoundIndex: snapshot.expectedRoundIndex,
        createdAtServerMillis: snapshot.createdAtServerMillis,
        createdByUid: typeof doc.data.createdByUid === 'string' ? doc.data.createdByUid : '',
        restoreGeneration: snapshot.restoreGeneration,
        schemaVersion: 3,
      })
    }
  }
  manifests.sort((a, b) => b.createdAtServerMillis - a.createdAtServerMillis)
  return manifests
}

export interface WriteHouseholdCheckpointV2Input {
  firestore: HouseholdFirestoreDeps['firestore']
  readTeamView: (teamId: string, household: HouseholdState) => Promise<HouseholdStateTeamView>
  lessonRunId: string
  householdIds: string[]
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  expectedRoundIndex: number | null
  actorUid: string
  idempotencyKey: string
  nowMillis: number
}

export const writeHouseholdCheckpointV2 = (
  input: WriteHouseholdCheckpointV2Input,
): Promise<{ checkpointId: string; created: boolean }> =>
  input.firestore.runTransaction(async (tx) => {
    const keyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
    const mappingPath = `lessonRuns/${input.lessonRunId}/householdCheckpointV2Idempotency/${keyId}`
    const digest = requestDigest({
      kind: input.kind,
      label: input.label,
      expectedRoundIndex: input.expectedRoundIndex,
      actorUid: input.actorUid,
    })

    // ---- ALL READS FIRST ----
    const mappingSnap = await tx.get(mappingPath)
    if (mappingSnap.exists) {
      const prior = mappingSnap.data() as { checkpointId: string; requestDigest: string }
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return { checkpointId: prior.checkpointId, created: false }
    }

    const runPath = `lessonRuns/${input.lessonRunId}`
    const runSnap = await tx.get(runPath)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const runData = runSnap.data() as { restoreGeneration?: number; currentPhaseId?: string }
    const restoreGeneration = typeof runData.restoreGeneration === 'number' ? runData.restoreGeneration : 0
    const phaseId = typeof runData.currentPhaseId === 'string' ? runData.currentPhaseId : '__NO_PHASE__'

    const counterSnap = await tx.get(`lessonRuns/${input.lessonRunId}/meta/eventCounter`)
    const sequence = counterSnap.exists && typeof counterSnap.data()?.value === 'number'
      ? (counterSnap.data()?.value as number)
      : -1

    const sortedHouseholdIds = [...input.householdIds].sort()
    const households: HouseholdState[] = []
    for (const householdId of sortedHouseholdIds) {
      const hSnap = await tx.get(`lessonRuns/${input.lessonRunId}/households/${householdId}`)
      if (!hSnap.exists) throw new Error(`HouseholdState not found: ${householdId}`)
      households.push(hSnap.data() as unknown as HouseholdState)
    }

    // Read team views (async helper)
    const teamViews: Record<string, HouseholdStateTeamView> = {}
    for (const h of households) {
      teamViews[h.teamId] = await input.readTeamView(h.teamId, h)
    }

    // ---- ALL WRITES AFTER ----
    const checkpointId = `hcp_${restoreGeneration}_${keyId.slice(0, 20)}`
    const snapshot = buildHouseholdCheckpointSnapshotV2({
      kind: input.kind,
      label: input.label,
      createdAtServerMillis: input.nowMillis,
      createdByUid: input.actorUid,
      expectedRoundIndex: input.expectedRoundIndex,
      householdIds: sortedHouseholdIds,
      households,
      teamViews,
    })

    const checkpointDoc = {
      id: checkpointId,
      lessonRunId: input.lessonRunId,
      sequence,
      phaseId,
      snapshot,
      createdBy: 'TEACHER',
      restoreGeneration,
      requestDigest: digest,
      createdAtServerMillis: input.nowMillis,
    }

    tx.set(`lessonRuns/${input.lessonRunId}/checkpoints/${checkpointId}`, checkpointDoc as unknown as Record<string, unknown>)
    tx.set(mappingPath, { checkpointId, requestDigest: digest })

    return { checkpointId, created: true }
  })

export interface WriteHouseholdCheckpointV3Input {
  firestore: HouseholdFirestoreDeps['firestore']
  lessonRunId: string
  courseFormat: AdvancedHouseholdCourseFormat
  /** Runtime household ids to include — the FROZEN assignment's targets. */
  householdIds: string[]
  /**
   * The `HouseholdRuntimeControl.assignmentRevision` the caller observed
   * OUTSIDE this transaction (same "outer read to decide, inner
   * transaction just uses it" shape `BulkSettlementDeps.writePreSettlementCheckpoint`
   * and `saveManualAdvancedHouseholdCheckpointWithAdminSdk` both follow —
   * this writer does not itself re-verify it against a fresh control read,
   * since a checkpoint write is not a mutating decision that needs to
   * reject on staleness the way `saveAdvancedHouseholdDecision` does; it
   * only needs to RECORD which revision was in effect).
   */
  assignmentRevision: number
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  expectedRoundIndex: number
  actorUid: string
  idempotencyKey: string
  nowMillis: number
  visibleConcepts: ConceptCategory[]
}

/**
 * Advanced-format (ROLE_VARIANT / STAGE_SPLIT / MULTI_PERSON_PER_TEAM) v3
 * checkpoint writer — replaces Task 6's interim
 * `writeAdvancedPreSettlementCheckpointPlaceholderWithAdminSdk`
 * (`bulkSettlement.ts`) with a real, full-fidelity writer.
 *
 * Design choice — no separate RTDB team-view read (unlike v2's
 * `input.readTeamView`): the real per-team, multiple-households-per-team
 * RTDB projection this format needs does not exist yet (it is Task 9's own
 * deliverable, which comes AFTER this task). Rather than guess at that
 * not-yet-built RTDB shape, `teamViews` here is built DIRECTLY from the
 * SAME `HouseholdState` docs this transaction already reads below (via
 * `buildHouseholdCheckpointSnapshotV3` -> `toHouseholdStateTeamView`) — see
 * that function's doc comment for what is intentionally omitted
 * (`eventDisclosures`/`shortfallOptions`). This is also arguably the more
 * correct choice regardless of Task 9's ordering: a checkpoint of
 * Firestore-authoritative state should not need to trust a separately
 * maintained RTDB projection's freshness, and deriving `teamViews` from the
 * very household reads being checkpointed makes the two trivially
 * consistent by construction (no separate "verify projection round matches
 * state" step is needed, because there is no second source to disagree).
 *
 * Same transaction discipline as `writeHouseholdCheckpointV2`: ALL reads
 * (idempotency mapping, LessonRun, every named household by sorted runtime
 * id) before ANY writes (checkpoint doc + idempotency mapping).
 *
 * Idempotency digest deliberately includes `assignmentRevision`,
 * `expectedRoundIndex`, `restoreGeneration` (read from the LessonRun doc
 * INSIDE this same transaction, before the digest is computed — the mapping
 * doc is fetched first but its equality check is deferred until after
 * `restoreGeneration` is known) and the sorted household id list — Task 6's
 * own bulk-settlement digest initially omitted its target-list coverage and
 * had to be corrected after review; this writer does not repeat that gap.
 */
export const writeHouseholdCheckpointV3 = (
  input: WriteHouseholdCheckpointV3Input,
): Promise<{ checkpointId: string; created: boolean }> =>
  input.firestore.runTransaction(async (tx) => {
    const keyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
    const mappingPath = `lessonRuns/${input.lessonRunId}/householdCheckpointV3Idempotency/${keyId}`
    const sortedHouseholdIds = [...input.householdIds].sort()

    // ---- ALL READS FIRST ----
    const mappingSnap = await tx.get(mappingPath)

    const runPath = `lessonRuns/${input.lessonRunId}`
    const runSnap = await tx.get(runPath)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const runData = runSnap.data() as { restoreGeneration?: number } | undefined
    const restoreGeneration = typeof runData?.restoreGeneration === 'number' ? runData.restoreGeneration : 0

    const digest = requestDigest({
      kind: input.kind,
      label: input.label,
      expectedRoundIndex: input.expectedRoundIndex,
      actorUid: input.actorUid,
      assignmentRevision: input.assignmentRevision,
      restoreGeneration,
      householdIds: sortedHouseholdIds,
    })

    if (mappingSnap.exists) {
      const prior = mappingSnap.data() as { checkpointId: string; requestDigest: string }
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return { checkpointId: prior.checkpointId, created: false }
    }

    const households: HouseholdState[] = []
    for (const householdId of sortedHouseholdIds) {
      const hSnap = await tx.get(`lessonRuns/${input.lessonRunId}/households/${householdId}`)
      if (!hSnap.exists) throw new Error(`HouseholdState not found: ${householdId}`)
      households.push(hSnap.data() as unknown as HouseholdState)
    }

    // ---- ALL WRITES AFTER ----
    const checkpointId = `hcp_${restoreGeneration}_${keyId.slice(0, 20)}`
    const snapshot = buildHouseholdCheckpointSnapshotV3({
      courseFormat: input.courseFormat,
      assignmentRevision: input.assignmentRevision,
      restoreGeneration,
      expectedRoundIndex: input.expectedRoundIndex,
      householdIds: sortedHouseholdIds,
      householdStates: households,
      visibleConcepts: input.visibleConcepts,
      createdAtServerMillis: input.nowMillis,
    })

    const checkpointDoc = {
      id: checkpointId,
      lessonRunId: input.lessonRunId,
      kind: input.kind,
      label: input.label,
      createdByUid: input.actorUid,
      snapshot,
      createdBy: 'TEACHER',
      restoreGeneration,
      requestDigest: digest,
      createdAtServerMillis: input.nowMillis,
    }

    tx.set(`lessonRuns/${input.lessonRunId}/checkpoints/${checkpointId}`, checkpointDoc as unknown as Record<string, unknown>)
    tx.set(mappingPath, { checkpointId, requestDigest: digest })

    return { checkpointId, created: true }
  })

export const readTeamViewWithAdminSdk = async (
  lessonRunId: string,
  teamId: string,
  household: HouseholdState,
  content: HomeEconomicsContent,
): Promise<HouseholdStateTeamView> => {
  const rtdb = getDatabase()
  const snap = await rtdb.ref(`lessonRunTeamState/${lessonRunId}/${teamId}/household`).get()
  if (snap.exists()) {
    return snap.val() as HouseholdStateTeamView
  }

  if (household.roundIndex === 0) {
    const visibleConcepts = resolveVisibleConcepts(content.goalPackage)
    return toHouseholdStateTeamView(household, visibleConcepts, [], [])
  }

  throw new Error(`Missing team projection for team ${teamId} at round ${household.roundIndex}`)
}

export interface SaveManualHouseholdCheckpointInput {
  lessonRunId: string
  label: string
  actorUid: string
  idempotencyKey: string
}

export const saveManualHouseholdCheckpointWithAdminSdk = async (
  input: SaveManualHouseholdCheckpointInput,
): Promise<{ checkpointId: string; created: boolean }> => {
  const trimmedLabel = input.label.trim()
  if (trimmedLabel.length < 1 || trimmedLabel.length > 80) {
    throw new Error('Label must be between 1 and 80 characters')
  }

  const activeLease = await findActiveBulkSettlementLeaseWithAdminSdk(input.lessonRunId, Date.now())
  if (activeLease) {
    throw new Error('Active bulk operation lease is active')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${input.lessonRunId}`).get()
  if (!runSnap.exists) throw new Error('LessonRun not found')
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  const homeEconomics = templateSnapshot?.homeEconomics
  if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')

  const teamsSnap = await db.collection(`lessonRuns/${input.lessonRunId}/teams`).get()
  const teamIds = teamsSnap.docs.map((doc) => doc.id).sort()

  const households: HouseholdState[] = []
  for (const teamId of teamIds) {
    const h = await ensureCommonConditionsHouseholdStateWithAdminSdk(input.lessonRunId, teamId, homeEconomics)
    households.push(h)
  }

  const roundIndices = new Set(households.map((h) => h.roundIndex))
  const expectedRoundIndex = roundIndices.size === 1 ? households[0].roundIndex : null

  const { householdRepositoryWithAdminSdk } = await import('../lessonRuns/households/repository')

  return writeHouseholdCheckpointV2({
    firestore: householdRepositoryWithAdminSdk(),
    readTeamView: (teamId, h) => readTeamViewWithAdminSdk(input.lessonRunId, teamId, h, homeEconomics),
    lessonRunId: input.lessonRunId,
    householdIds: teamIds,
    kind: 'MANUAL',
    label: trimmedLabel,
    expectedRoundIndex,
    actorUid: input.actorUid,
    idempotencyKey: input.idempotencyKey,
    nowMillis: Date.now(),
  })
}

export interface SaveManualAdvancedHouseholdCheckpointInput {
  lessonRunId: string
  label: string
  actorUid: string
  idempotencyKey: string
}

/**
 * Advanced-format (ROLE_VARIANT / STAGE_SPLIT / MULTI_PERSON_PER_TEAM)
 * counterpart to `saveManualHouseholdCheckpointWithAdminSdk` (Common-only,
 * v2). `writeHouseholdCheckpointCallable` (`onCall.ts`) dispatches here
 * instead of the v2 function once it has read the LessonRun's
 * `courseFormat` and found it advanced.
 *
 * Rejection while SETTLING: unlike Common (no `HouseholdRuntimeControl`
 * document exists, so its only guard is the bulk-lease check below), an
 * advanced lesson's control document is the SAME `roundStatus`/
 * `activeOperationId` lock `createOrReplayBulkSettlementOperationWithControlLock`
 * (`bulkSettlementOperation.ts`) flips to `SETTLING` for the duration of a
 * bulk operation. A manual checkpoint attempted while that lock is held
 * would race the bulk operation's own PRE_SETTLEMENT checkpoint and
 * in-flight household writes, so it is rejected outright — read OUTSIDE any
 * transaction (a manual checkpoint is not itself a mutating decision that
 * needs to re-verify a fresh read inside a transaction the way
 * `saveAdvancedHouseholdDecision` does; observing `SETTLING` here is enough
 * to refuse, and a benign race where the lock releases a moment later just
 * means the teacher retries).
 */
export const saveManualAdvancedHouseholdCheckpointWithAdminSdk = async (
  input: SaveManualAdvancedHouseholdCheckpointInput,
): Promise<{ checkpointId: string; created: boolean }> => {
  const trimmedLabel = input.label.trim()
  if (trimmedLabel.length < 1 || trimmedLabel.length > 80) {
    throw new Error('Label must be between 1 and 80 characters')
  }

  const activeLease = await findActiveBulkSettlementLeaseWithAdminSdk(input.lessonRunId, Date.now())
  if (activeLease) {
    throw new Error('Active bulk operation lease is active')
  }

  const { getHouseholdRuntimeControlWithAdminSdk } = await import('../lessonRuns/households/repository')
  const control = await getHouseholdRuntimeControlWithAdminSdk(input.lessonRunId)
  if (!control) throw new Error('HouseholdRuntimeControl not found')
  if (control.roundStatus === 'SETTLING') {
    throw new Error('HouseholdRuntimeControl round is not OPEN (a bulk settlement is in progress)')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${input.lessonRunId}`).get()
  if (!runSnap.exists) throw new Error('LessonRun not found')
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  const homeEconomics = templateSnapshot?.homeEconomics
  if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')

  const entriesSnap = await db.collection(`lessonRuns/${input.lessonRunId}/householdAssignment/config/entries`).get()
  if (entriesSnap.empty) throw new Error('HouseholdAssignment has not been prepared for this lesson yet')
  const householdIds = entriesSnap.docs
    .map((doc) => (doc.data() as unknown as HouseholdAssignmentEntry).householdId)
    .sort()

  const visibleConcepts = resolveVisibleConcepts(homeEconomics.goalPackage)

  const { householdRepositoryWithAdminSdk } = await import('../lessonRuns/households/repository')

  return writeHouseholdCheckpointV3({
    firestore: householdRepositoryWithAdminSdk(),
    lessonRunId: input.lessonRunId,
    courseFormat: control.courseFormat,
    householdIds,
    assignmentRevision: control.assignmentRevision,
    kind: 'MANUAL',
    label: trimmedLabel,
    // Advanced formats keep a single canonical round for the whole lesson
    // on the control document (`synchronizedRoundIndex`) rather than
    // deriving it from a possibly-misaligned set of household reads.
    expectedRoundIndex: control.synchronizedRoundIndex,
    actorUid: input.actorUid,
    idempotencyKey: input.idempotencyKey,
    nowMillis: Date.now(),
    visibleConcepts,
  })
}

export const listHouseholdCheckpointManifestsWithAdminSdk = async (
  lessonRunId: string,
): Promise<HouseholdCheckpointManifest[]> => {
  const db = getFirestore()
  const snap = await db.collection(`lessonRuns/${lessonRunId}/checkpoints`).get()
  const docs = snap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as Record<string, unknown>,
  }))
  return listHouseholdCheckpointManifests(docs)
}
