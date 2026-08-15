import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import {
  householdRepositoryWithAdminSdk,
  type HouseholdFirestoreDeps,
  type HouseholdState,
} from '../lessonRuns/households/repository'
import {
  findActiveBulkSettlementLeaseWithAdminSdk,
} from './bulkSettlementOperation'
import {
  isHouseholdCheckpointSnapshotV2,
  readTeamViewWithAdminSdk,
  writeHouseholdCheckpointV2,
  type HouseholdCheckpointSnapshotV2,
} from './householdCheckpoint'
import { appendLessonEventInTransaction, type FirestoreTx } from '../lessonRuns/appendLessonEvent'
import { ensureCommonConditionsHouseholdStateWithAdminSdk } from './commonConditionsHousehold'

export interface HouseholdRestoreIdempotencyRecord {
  checkpointId: string
  requestDigest: string
  newRestoreGeneration: number
  eventId: string
  preRestoreCheckpointId: string
  projectionStatus: 'PENDING' | 'SYNCED'
}

export interface HouseholdRestoreDeps {
  firestore: HouseholdFirestoreDeps['firestore']
  checkActiveBulkLease: (lessonRunId: string, nowMillis: number) => Promise<boolean>
  listTeamIds: (lessonRunId: string) => Promise<string[]>
  savePreRestoreCheckpoint: (input: {
    lessonRunId: string
    actorUid: string
    idempotencyKey: string
    nowMillis: number
  }) => Promise<{ checkpointId: string; created: boolean }>
  syncRtdbProjections: (updates: Record<string, unknown>) => Promise<void>
}

export interface RestoreHouseholdCheckpointV2Input {
  lessonRunId: string
  checkpointId: string
  reason: string
  actorUid: string
  idempotencyKey: string
  nowMillis: number
}

export interface RestoreHouseholdCheckpointV2Result {
  newRestoreGeneration: number
  restoredHouseholdIds: string[]
  preRestoreCheckpointId: string
}

export const restoreHouseholdCheckpointV2 = async (
  deps: HouseholdRestoreDeps,
  input: RestoreHouseholdCheckpointV2Input,
): Promise<RestoreHouseholdCheckpointV2Result> => {
  const trimmedReason = input.reason.trim()
  if (!trimmedReason) {
    throw new Error('Reason is required')
  }

  const isLeaseActive = await deps.checkActiveBulkLease(input.lessonRunId, input.nowMillis)
  if (isLeaseActive) {
    throw new Error('Active bulk operation lease is active')
  }

  const keyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const preRestoreIdempotencyKey = `pre-restore:${keyId}`
  const preRestore = await deps.savePreRestoreCheckpoint({
    lessonRunId: input.lessonRunId,
    actorUid: input.actorUid,
    idempotencyKey: preRestoreIdempotencyKey,
    nowMillis: input.nowMillis,
  })

  const digest = requestDigest({
    checkpointId: input.checkpointId,
    reason: trimmedReason,
    actorUid: input.actorUid,
  })

  const txResult = await deps.firestore.runTransaction(async (tx) => {
    const txAdapter: FirestoreTx = {
      get: async (path) => tx.get(path),
      set: (path, data) => tx.set(path, data),
    }

    const idempotencyPath = `lessonRuns/${input.lessonRunId}/householdCheckpointRestoreIdempotency/${keyId}`

    // ---- ALL READS FIRST ----
    const idempSnap = await tx.get(idempotencyPath)
    if (idempSnap.exists) {
      const prior = idempSnap.data() as unknown as HouseholdRestoreIdempotencyRecord
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      const cpSnap = await tx.get(`lessonRuns/${input.lessonRunId}/checkpoints/${prior.checkpointId}`)
      const cpData = cpSnap.data() as { snapshot?: HouseholdCheckpointSnapshotV2 } | undefined
      const runSnap = await tx.get(`lessonRuns/${input.lessonRunId}`)
      const runData = runSnap.data() as { orgId?: string; restoreGeneration?: number } | undefined
      return {
        record: prior,
        alreadyCommitted: true,
        snapshot: cpData?.snapshot as HouseholdCheckpointSnapshotV2,
        orgId: runData?.orgId ?? '',
        currentRestoreGeneration: typeof runData?.restoreGeneration === 'number' ? runData.restoreGeneration : 0,
      }
    }

    const runPath = `lessonRuns/${input.lessonRunId}`
    const runSnap = await tx.get(runPath)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const runData = runSnap.data() as { orgId?: string; restoreGeneration?: number }
    const orgId = runData.orgId ?? ''
    const currentGeneration = typeof runData.restoreGeneration === 'number' ? runData.restoreGeneration : 0

    const checkpointPath = `lessonRuns/${input.lessonRunId}/checkpoints/${input.checkpointId}`
    const checkpointSnap = await tx.get(checkpointPath)
    if (!checkpointSnap.exists) throw new Error('Checkpoint not found')
    const checkpointData = checkpointSnap.data() as { snapshot?: unknown }
    const snapshot = checkpointData.snapshot

    if (!isHouseholdCheckpointSnapshotV2(snapshot) || snapshot.scope !== 'ALL_HOUSEHOLDS') {
      throw new Error('復元できるのは v2 かつ ALL_HOUSEHOLDS のチェックポイントのみです')
    }

    // Read all target household states
    for (const household of snapshot.households) {
      await tx.get(`lessonRuns/${input.lessonRunId}/households/${household.householdId}`)
    }

    const newRestoreGeneration = currentGeneration + 1

    // Append LessonEvent (reads counter/idempotency inside read phase)
    const event = await appendLessonEventInTransaction(txAdapter, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'CHECKPOINT_RESTORED',
      actorType: 'TEACHER',
      actorId: input.actorUid,
      payload: {
        checkpointId: input.checkpointId,
        reason: trimmedReason,
        restoreGeneration: newRestoreGeneration,
        preRestoreCheckpointId: preRestore.checkpointId,
      },
      idempotencyKey: `restore_${input.lessonRunId}_${keyId}`,
    }, input.nowMillis)

    // ---- ALL WRITES AFTER ----
    tx.set(runPath, {
      ...runData,
      restoreGeneration: newRestoreGeneration,
      updatedAtServerMillis: input.nowMillis,
    })

    for (const household of snapshot.households) {
      const restoredState: HouseholdState = {
        ...household,
        updatedAtServerMillis: input.nowMillis,
      }
      tx.set(`lessonRuns/${input.lessonRunId}/households/${household.householdId}`, restoredState as unknown as Record<string, unknown>)
    }

    const record: HouseholdRestoreIdempotencyRecord = {
      checkpointId: input.checkpointId,
      requestDigest: digest,
      newRestoreGeneration,
      eventId: event.eventId,
      preRestoreCheckpointId: preRestore.checkpointId,
      projectionStatus: 'PENDING',
    }
    tx.set(idempotencyPath, record as unknown as Record<string, unknown>)

    return {
      record,
      alreadyCommitted: false,
      snapshot,
      orgId,
      currentRestoreGeneration: newRestoreGeneration,
    }
  })

  const { record, alreadyCommitted, snapshot, orgId, currentRestoreGeneration } = txResult

  if (alreadyCommitted && record.projectionStatus === 'SYNCED') {
    return {
      newRestoreGeneration: record.newRestoreGeneration,
      restoredHouseholdIds: snapshot.householdIds,
      preRestoreCheckpointId: record.preRestoreCheckpointId,
    }
  }

  if (alreadyCommitted && currentRestoreGeneration !== record.newRestoreGeneration) {
    throw new Error('より新しい世代の復元が行われたため再同期できません')
  }

  // Sync RTDB
  const rtdbUpdates: Record<string, unknown> = {}
  for (const [teamId, teamView] of Object.entries(snapshot.teamViews)) {
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/household`] = teamView
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/orgId`] = orgId
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/updatedAtMillis`] = input.nowMillis
    rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/householdComputationLog/${teamId}`] = null
  }
  rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/orgId`] = orgId
  rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/updatedAtMillis`] = input.nowMillis

  await deps.syncRtdbProjections(rtdbUpdates)

  // Mark SYNCED
  await deps.firestore.runTransaction(async (tx) => {
    const idempotencyPath = `lessonRuns/${input.lessonRunId}/householdCheckpointRestoreIdempotency/${keyId}`
    const snap = await tx.get(idempotencyPath)
    if (snap.exists) {
      const current = snap.data() as unknown as HouseholdRestoreIdempotencyRecord
      tx.set(idempotencyPath, {
        ...current,
        projectionStatus: 'SYNCED',
      })
    }
  })

  return {
    newRestoreGeneration: record.newRestoreGeneration,
    restoredHouseholdIds: snapshot.householdIds,
    preRestoreCheckpointId: record.preRestoreCheckpointId,
  }
}

export const restoreHouseholdCheckpointV2DepsWithAdminSdk = (): HouseholdRestoreDeps => {
  const db = getFirestore()
  const rtdb = getDatabase()
  return {
    firestore: householdRepositoryWithAdminSdk(),
    checkActiveBulkLease: async (lessonRunId, nowMillis) => {
      const active = await findActiveBulkSettlementLeaseWithAdminSdk(lessonRunId, nowMillis)
      return active !== null
    },
    listTeamIds: async (lessonRunId) => {
      const snap = await db.collection(`lessonRuns/${lessonRunId}/teams`).get()
      return snap.docs.map((doc) => doc.id)
    },
    savePreRestoreCheckpoint: async (input) => {
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

      return writeHouseholdCheckpointV2({
        firestore: householdRepositoryWithAdminSdk(),
        readTeamView: (teamId, h) => readTeamViewWithAdminSdk(input.lessonRunId, teamId, h, homeEconomics),
        lessonRunId: input.lessonRunId,
        householdIds: teamIds,
        kind: 'PRE_RESTORE',
        label: '復元前自動退避',
        expectedRoundIndex,
        actorUid: input.actorUid,
        idempotencyKey: input.idempotencyKey,
        nowMillis: input.nowMillis,
      })
    },
    syncRtdbProjections: async (updates) => {
      await rtdb.ref().update(updates)
    },
  }
}

export const restoreHouseholdCheckpointV2WithAdminSdk = (
  input: RestoreHouseholdCheckpointV2Input,
): Promise<RestoreHouseholdCheckpointV2Result> =>
  restoreHouseholdCheckpointV2(restoreHouseholdCheckpointV2DepsWithAdminSdk(), input)
