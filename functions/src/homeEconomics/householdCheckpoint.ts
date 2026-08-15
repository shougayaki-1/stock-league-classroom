import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import type { HouseholdFirestoreDeps, HouseholdState } from '../lessonRuns/households/repository'
import { toHouseholdStateTeamView, type HouseholdStateTeamView } from './realtimeProjection'
import { resolveVisibleConcepts } from './goalPackage'
import { findActiveBulkSettlementLeaseWithAdminSdk } from './bulkSettlementOperation'
import { ensureCommonConditionsHouseholdStateWithAdminSdk } from './commonConditionsHousehold'

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
