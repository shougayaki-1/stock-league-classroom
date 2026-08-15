import { getFirestore } from 'firebase-admin/firestore'
import type { CourseFormat, HouseholdProfile } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import {
  buildDefaultHouseholdAssignmentEntries,
  teamSetFingerprint,
  validateHouseholdAssignmentEntries,
  type AdvancedHouseholdCourseFormat,
  type HouseholdAssignmentEntry,
  type HouseholdAssignmentWarning,
} from './householdAssignment'

export interface HouseholdAssignmentConfig {
  courseFormat: CourseFormat
  state: 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number
  teamSetFingerprint: string
  entryIds: string[]
  entriesDigest: string
  lastEditedByUid: string
  lastEditedAtServerMillis: number
  frozenByUid?: string
  frozenAtServerMillis?: number
}

export interface HouseholdAssignmentView {
  lessonRunId: string
  courseFormat: CourseFormat
  state: 'UNPREPARED' | 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number | null
  warnings: HouseholdAssignmentWarning[]
  teams: Array<{
    teamId: string
    teamDisplayName: string
    entries: Array<{
      householdId: string
      profileId: string
      displayOrder: number
      assignmentSource: 'AUTO' | 'MANUAL'
    }>
  }>
}

/**
 * Exact server-owned Firestore paths for this feature (Task 2 brief). The
 * config document and its `entries` subcollection intentionally live under
 * the SAME `config` document id (`.../householdAssignment/config/entries/
 * {runtimeHouseholdId}`) — not a sibling collection — so a single document
 * read tells the caller whether an assignment has ever been prepared, and
 * the entries subcollection is trivially reachable from that same path.
 */
const configPath = (lessonRunId: string): string => `lessonRuns/${lessonRunId}/householdAssignment/config`
const entriesCollectionPath = (lessonRunId: string): string => `${configPath(lessonRunId)}/entries`
const entryPath = (lessonRunId: string, householdId: string): string => `${entriesCollectionPath(lessonRunId)}/${householdId}`
const assignmentIdempotencyPath = (lessonRunId: string, idempotencyKey: string): string =>
  `lessonRuns/${lessonRunId}/householdAssignmentIdempotency/${idempotencyDocumentId(lessonRunId, idempotencyKey)}`

/**
 * Transaction abstraction matching this repo's established shape
 * (`households/repository.ts`'s `HouseholdTx`, `betaAccess.ts`'s
 * `AiBetaAccessTransaction`): plain-path get/set, plus `getCollection` so
 * the entries subcollection can be read — a Firestore transaction rule
 * requirement — entirely within the READ phase, before any `set`/`delete`.
 */
export interface HouseholdAssignmentTx {
  get(path: string): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
  getCollection(path: string): Promise<Array<{ id: string; data: Record<string, unknown> }>>
  set(path: string, data: Record<string, unknown>): void
  delete(path: string): void
}

export interface HouseholdAssignmentFirestoreDeps {
  firestore: { runTransaction<T>(fn: (tx: HouseholdAssignmentTx) => Promise<T>): Promise<T> }
}

/** Production wiring: Firestore Admin SDK. */
export const householdAssignmentRepositoryWithAdminSdk = (): HouseholdAssignmentFirestoreDeps['firestore'] => {
  const db = getFirestore()
  return {
    runTransaction: (fn) => db.runTransaction((adminTx) => fn({
      get: async (path: string) => {
        const snap = await adminTx.get(db.doc(path))
        return { exists: snap.exists, data: () => snap.data() }
      },
      getCollection: async (path: string) => {
        const snap = await adminTx.get(db.collection(path))
        return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
      },
      set: (path: string, data: Record<string, unknown>) => { adminTx.set(db.doc(path), data) },
      delete: (path: string) => { adminTx.delete(db.doc(path)) },
    })),
  }
}

/** Read-only (non-transactional) Firestore access for `getHouseholdAssignmentView`. */
export interface HouseholdAssignmentReadDeps {
  getDoc(path: string): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
  getCollection(path: string): Promise<Array<{ id: string; data: Record<string, unknown> }>>
}

export const householdAssignmentReadDepsWithAdminSdk = (): HouseholdAssignmentReadDeps => {
  const db = getFirestore()
  return {
    getDoc: async (path: string) => {
      const snap = await db.doc(path).get()
      return { exists: snap.exists, data: () => snap.data() }
    },
    getCollection: async (path: string) => {
      const snap = await db.collection(path).get()
      return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
    },
  }
}

const sortedTeamIds = (teamIds: string[]): string[] => [...teamIds].sort()

const entryKey = (teamId: string, slotKey: string): string => `${teamId}:${slotKey}`

/**
 * STALE reconciliation: regenerates the default AUTO assignment for the
 * current team set, then overlays any prior MANUAL entry whose (teamId,
 * slotKey) still exists in the regenerated set AND whose team still exists
 * in the current team set. `slotKey` (not `householdId`, which is derived
 * from both) is the stable identity of "which profile slot" a manual edit
 * targeted — see `householdAssignment.ts`'s `HouseholdAssignmentEntry` doc
 * comment. A manual entry whose slot no longer exists after reconciliation
 * (e.g. its team was removed, or STAGE_SPLIT's stage-to-team mapping
 * shifted) is dropped rather than resurrected under a different slot —
 * there is no unambiguous "which new slot" to move it to.
 */
const preserveValidManualEntries = (
  regenerated: HouseholdAssignmentEntry[],
  priorEntries: HouseholdAssignmentEntry[],
  currentTeamIds: string[],
): HouseholdAssignmentEntry[] => {
  const currentTeamIdSet = new Set(currentTeamIds)
  const manualByKey = new Map(
    priorEntries
      .filter((entry) => entry.assignmentSource === 'MANUAL' && currentTeamIdSet.has(entry.teamId))
      .map((entry) => [entryKey(entry.teamId, entry.slotKey), entry] as const),
  )
  return regenerated.map((entry) => {
    const manual = manualByKey.get(entryKey(entry.teamId, entry.slotKey))
    if (!manual) return entry
    return { ...entry, profileId: manual.profileId, displayOrder: manual.displayOrder, assignmentSource: 'MANUAL' as const }
  })
}

const buildTeamsView = (
  entries: HouseholdAssignmentEntry[],
  teamDisplayNames: Record<string, string>,
): HouseholdAssignmentView['teams'] => {
  const teamsMap = new Map<string, HouseholdAssignmentView['teams'][number]>()
  for (const entry of entries) {
    let team = teamsMap.get(entry.teamId)
    if (!team) {
      team = { teamId: entry.teamId, teamDisplayName: teamDisplayNames[entry.teamId] ?? entry.teamId, entries: [] }
      teamsMap.set(entry.teamId, team)
    }
    team.entries.push({
      householdId: entry.householdId,
      profileId: entry.profileId,
      displayOrder: entry.displayOrder,
      assignmentSource: entry.assignmentSource,
    })
  }
  for (const team of teamsMap.values()) team.entries.sort((a, b) => a.displayOrder - b.displayOrder)
  return sortedTeamIds([...teamsMap.keys()]).map((teamId) => teamsMap.get(teamId)!)
}

/**
 * Pure projection from a persisted config+entries pair to the wire-shape
 * `HouseholdAssignmentView`. `state` is DERIVED here, never read directly
 * off `config.state` for the STALE case: `config.state` at rest is only
 * ever 'DRAFT' or 'FROZEN' (this repository never persists 'STALE') —
 * STALE is a live comparison between the config's `teamSetFingerprint` and
 * the CURRENT team set, computed fresh on every read so it reflects team
 * roster changes that happened after the last prepare/update without
 * requiring a write. See task-2-report.md for why this shape was chosen
 * over persisting 'STALE' directly.
 */
export const buildHouseholdAssignmentView = (input: {
  lessonRunId: string
  courseFormat: CourseFormat
  config: HouseholdAssignmentConfig
  entries: HouseholdAssignmentEntry[]
  currentTeamIds: string[]
  teamDisplayNames: Record<string, string>
  profiles: HouseholdProfile[]
}): HouseholdAssignmentView => {
  const currentFingerprint = teamSetFingerprint(input.currentTeamIds)
  const state: HouseholdAssignmentView['state'] = input.config.state === 'FROZEN'
    ? 'FROZEN'
    : input.config.teamSetFingerprint !== currentFingerprint ? 'STALE' : 'DRAFT'

  const validation = validateHouseholdAssignmentEntries({
    courseFormat: input.courseFormat,
    teamIds: input.currentTeamIds,
    profiles: input.profiles,
    entries: input.entries,
  })

  return {
    lessonRunId: input.lessonRunId,
    courseFormat: input.courseFormat,
    state,
    validationStatus: validation.status,
    assignmentRevision: input.config.assignmentRevision,
    warnings: validation.warnings,
    teams: buildTeamsView(input.entries, input.teamDisplayNames),
  }
}

export interface HouseholdAssignmentMutationResult {
  config: HouseholdAssignmentConfig
  entries: HouseholdAssignmentEntry[]
  deduplicated: boolean
}

interface StoredIdempotencyRecord {
  digest: string
  result: Omit<HouseholdAssignmentMutationResult, 'deduplicated'>
}

export interface PrepareHouseholdAssignmentCoreInput extends HouseholdAssignmentFirestoreDeps {
  lessonRunId: string
  courseFormat: AdvancedHouseholdCourseFormat
  teamIds: string[]
  profiles: HouseholdProfile[]
  actorUid: string
  idempotencyKey: string
  now: () => number
}

/**
 * First generation (no existing config doc) or STALE reconciliation
 * (config exists but its `teamSetFingerprint` no longer matches the
 * current team set). Idempotent per `idempotencyKey`: a replayed key with
 * the same `(courseFormat, teamIds)` payload returns the prior result
 * unchanged; a reused key with a different payload throws.
 *
 * Firestore transaction rule: ALL reads (idempotency record, config,
 * entries subcollection) happen before ANY write, matching every other
 * transactional flow in this repo (`households/repository.ts`,
 * `ai/betaAccess.ts`).
 */
export const prepareHouseholdAssignment = (
  input: PrepareHouseholdAssignmentCoreInput,
): Promise<HouseholdAssignmentMutationResult> => input.firestore.runTransaction(async (tx) => {
  const cfgPath = configPath(input.lessonRunId)
  const idPath = assignmentIdempotencyPath(input.lessonRunId, input.idempotencyKey)
  const digest = requestDigest({
    op: 'prepare',
    courseFormat: input.courseFormat,
    teamIds: sortedTeamIds(input.teamIds),
  })

  // ---- ALL READS FIRST ----
  const idempotencySnap = await tx.get(idPath)
  const configSnap = await tx.get(cfgPath)
  const priorEntryDocs = configSnap.exists ? await tx.getCollection(entriesCollectionPath(input.lessonRunId)) : []

  if (idempotencySnap.exists) {
    const stored = idempotencySnap.data() as unknown as StoredIdempotencyRecord
    if (stored.digest !== digest) throw new Error('Idempotency key payload mismatch')
    return { ...stored.result, deduplicated: true }
  }

  const fingerprint = teamSetFingerprint(input.teamIds)
  const priorEntries = priorEntryDocs.map((doc) => doc.data as unknown as HouseholdAssignmentEntry)

  let entries: HouseholdAssignmentEntry[]
  let assignmentRevision: number
  let unchanged = false

  if (!configSnap.exists) {
    entries = buildDefaultHouseholdAssignmentEntries({
      lessonRunId: input.lessonRunId, courseFormat: input.courseFormat, teamIds: input.teamIds, profiles: input.profiles,
    })
    assignmentRevision = 1
  } else {
    const existingConfig = configSnap.data() as unknown as HouseholdAssignmentConfig
    if (existingConfig.state === 'FROZEN') throw new Error('HouseholdAssignment is frozen')

    if (existingConfig.teamSetFingerprint === fingerprint) {
      // Team set unchanged since the last prepare — nothing to reconcile.
      entries = priorEntries
      assignmentRevision = existingConfig.assignmentRevision
      unchanged = true
    } else {
      const regenerated = buildDefaultHouseholdAssignmentEntries({
        lessonRunId: input.lessonRunId, courseFormat: input.courseFormat, teamIds: input.teamIds, profiles: input.profiles,
      })
      entries = preserveValidManualEntries(regenerated, priorEntries, input.teamIds)
      assignmentRevision = existingConfig.assignmentRevision + 1
    }
  }

  const validation = validateHouseholdAssignmentEntries({
    courseFormat: input.courseFormat, teamIds: input.teamIds, profiles: input.profiles, entries,
  })

  const config: HouseholdAssignmentConfig = {
    courseFormat: input.courseFormat,
    state: 'DRAFT',
    validationStatus: validation.status,
    assignmentRevision,
    teamSetFingerprint: fingerprint,
    entryIds: entries.map((entry) => entry.householdId),
    entriesDigest: requestDigest(entries),
    lastEditedByUid: input.actorUid,
    lastEditedAtServerMillis: input.now(),
  }

  // ---- ALL WRITES AFTER ----
  if (!unchanged) {
    tx.set(cfgPath, config as unknown as Record<string, unknown>)
    const nextIds = new Set(entries.map((entry) => entry.householdId))
    for (const doc of priorEntryDocs) {
      if (!nextIds.has(doc.id)) tx.delete(entryPath(input.lessonRunId, doc.id))
    }
    for (const entry of entries) {
      tx.set(entryPath(input.lessonRunId, entry.householdId), entry as unknown as Record<string, unknown>)
    }
  }

  const result: HouseholdAssignmentMutationResult = { config, entries, deduplicated: false }
  tx.set(idPath, { digest, result: { config, entries }, createdAtServerMillis: input.now() })
  return result
})

export interface UpdateHouseholdAssignmentCoreInput extends HouseholdAssignmentFirestoreDeps {
  lessonRunId: string
  courseFormat: AdvancedHouseholdCourseFormat
  teamIds: string[]
  profiles: HouseholdProfile[]
  expectedRevision: number
  changes: Array<{ householdId: string; profileId?: string; displayOrder?: number }>
  actorUid: string
  idempotencyKey: string
  now: () => number
}

/**
 * Applies per-household `profileId`/`displayOrder` edits against the
 * entries at `expectedRevision` (optimistic concurrency — rejects if the
 * caller's `expectedRevision` no longer matches). Rejects entirely if the
 * assignment is FROZEN. For MULTI_PERSON_PER_TEAM, a `profileId` change is
 * rejected outright — MULTI assigns the complete profile set to every
 * team, so there is no meaningful "which profile fills this slot" choice,
 * only display ordering.
 */
export const updateHouseholdAssignment = (
  input: UpdateHouseholdAssignmentCoreInput,
): Promise<HouseholdAssignmentMutationResult> => input.firestore.runTransaction(async (tx) => {
  const cfgPath = configPath(input.lessonRunId)
  const idPath = assignmentIdempotencyPath(input.lessonRunId, input.idempotencyKey)
  const digest = requestDigest({ op: 'update', expectedRevision: input.expectedRevision, changes: input.changes })

  // ---- ALL READS FIRST ----
  const idempotencySnap = await tx.get(idPath)
  const configSnap = await tx.get(cfgPath)
  const entryDocs = await tx.getCollection(entriesCollectionPath(input.lessonRunId))

  if (idempotencySnap.exists) {
    const stored = idempotencySnap.data() as unknown as StoredIdempotencyRecord
    if (stored.digest !== digest) throw new Error('Idempotency key payload mismatch')
    return { ...stored.result, deduplicated: true }
  }

  if (!configSnap.exists) throw new Error('HouseholdAssignment not found')
  const existingConfig = configSnap.data() as unknown as HouseholdAssignmentConfig
  if (existingConfig.state === 'FROZEN') throw new Error('HouseholdAssignment is frozen')
  if (existingConfig.assignmentRevision !== input.expectedRevision) throw new Error('Revision mismatch')

  const byId = new Map(entryDocs.map((doc) => [doc.id, doc.data as unknown as HouseholdAssignmentEntry]))

  for (const change of input.changes) {
    const entry = byId.get(change.householdId)
    if (!entry) throw new Error(`HouseholdAssignmentEntry not found: ${change.householdId}`)
    if (
      input.courseFormat === 'MULTI_PERSON_PER_TEAM'
      && change.profileId !== undefined
      && change.profileId !== entry.profileId
    ) {
      throw new Error('MULTI_PERSON_PER_TEAM does not support changing which profile fills a slot, only displayOrder')
    }
    const changesProfile = change.profileId !== undefined && change.profileId !== entry.profileId
    byId.set(change.householdId, {
      ...entry,
      ...(change.displayOrder !== undefined ? { displayOrder: change.displayOrder } : {}),
      ...(changesProfile ? { profileId: change.profileId!, assignmentSource: 'MANUAL' as const } : {}),
    })
  }

  const nextEntries = entryDocs.map((doc) => byId.get(doc.id)!)
  const validation = validateHouseholdAssignmentEntries({
    courseFormat: input.courseFormat, teamIds: input.teamIds, profiles: input.profiles, entries: nextEntries,
  })

  const nextConfig: HouseholdAssignmentConfig = {
    ...existingConfig,
    validationStatus: validation.status,
    assignmentRevision: existingConfig.assignmentRevision + 1,
    entryIds: nextEntries.map((entry) => entry.householdId),
    entriesDigest: requestDigest(nextEntries),
    lastEditedByUid: input.actorUid,
    lastEditedAtServerMillis: input.now(),
  }

  // ---- ALL WRITES AFTER ----
  tx.set(cfgPath, nextConfig as unknown as Record<string, unknown>)
  for (const change of input.changes) {
    const entry = byId.get(change.householdId)!
    tx.set(entryPath(input.lessonRunId, entry.householdId), entry as unknown as Record<string, unknown>)
  }

  const result: HouseholdAssignmentMutationResult = { config: nextConfig, entries: nextEntries, deduplicated: false }
  tx.set(idPath, { digest, result: { config: nextConfig, entries: nextEntries }, createdAtServerMillis: input.now() })
  return result
})

export interface GetHouseholdAssignmentViewInput {
  lessonRunId: string
  courseFormat: CourseFormat
  currentTeamIds: string[]
  teamDisplayNames: Record<string, string>
  profiles: HouseholdProfile[]
  /** Required only for COMMON_CONDITIONS's implicit compatibility view — see below. */
  commonProfile?: HouseholdProfile
  deps: HouseholdAssignmentReadDeps
}

/**
 * Read-only projection. Two format-dependent shapes:
 *
 * - COMMON_CONDITIONS is not one of the 3 advanced formats and never has a
 *   persisted assignment document (`prepare`/`update` refuse it — see
 *   `onCall.ts`). Every team already shares the template's single profile
 *   identically (`commonConditionsHousehold.ts`), so this synthesizes an
 *   "implicit compatibility view" instead: one AUTO entry per team, keyed
 *   `householdId === teamId` (matching the existing lazy-init convention),
 *   reported as `state: 'FROZEN'` since, from the caller's perspective,
 *   there is nothing left to prepare or edit — the assignment is already
 *   final by construction. This shape is a judgment call the brief left
 *   underspecified; see task-2-report.md.
 * - The 3 advanced formats read the persisted config+entries pair, if any
 *   (`state: 'UNPREPARED'` when no config doc exists yet), and project it
 *   through `buildHouseholdAssignmentView`.
 */
export const getHouseholdAssignmentView = async (
  input: GetHouseholdAssignmentViewInput,
): Promise<HouseholdAssignmentView> => {
  const { lessonRunId, courseFormat, currentTeamIds, teamDisplayNames } = input

  if (courseFormat === 'COMMON_CONDITIONS') {
    const entries: HouseholdAssignmentEntry[] = input.commonProfile
      ? sortedTeamIds(currentTeamIds).map((teamId) => ({
        householdId: teamId,
        teamId,
        profileId: input.commonProfile!.householdId,
        slotKey: input.commonProfile!.householdId,
        displayOrder: 0,
        assignmentSource: 'AUTO' as const,
      }))
      : []
    return {
      lessonRunId,
      courseFormat,
      state: 'FROZEN',
      validationStatus: 'READY',
      assignmentRevision: null,
      warnings: [],
      teams: buildTeamsView(entries, teamDisplayNames),
    }
  }

  const configSnap = await input.deps.getDoc(configPath(lessonRunId))
  if (!configSnap.exists) {
    return {
      lessonRunId, courseFormat, state: 'UNPREPARED', validationStatus: 'READY',
      assignmentRevision: null, warnings: [], teams: [],
    }
  }
  const config = configSnap.data() as unknown as HouseholdAssignmentConfig
  const entryDocs = await input.deps.getCollection(entriesCollectionPath(lessonRunId))
  const entries = entryDocs.map((doc) => doc.data as unknown as HouseholdAssignmentEntry)

  return buildHouseholdAssignmentView({
    lessonRunId, courseFormat, config, entries, currentTeamIds, teamDisplayNames, profiles: input.profiles,
  })
}
