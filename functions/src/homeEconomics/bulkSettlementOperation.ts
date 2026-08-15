import { getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import type { HouseholdFirestoreDeps } from '../lessonRuns/households/repository'

export const HOUSEHOLD_BULK_LEASE_MS = 60_000

export type HouseholdBulkOperationStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED'
export type HouseholdBulkItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'

export interface HouseholdBulkSettlementOperation {
  operationId: string
  lessonRunId: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  forceUnsubmitted: boolean
  status: HouseholdBulkOperationStatus
  preSettlementCheckpointId: string | null
  requestDigest: string
  attempt: number
  leaseExpiresAtServerMillis: number | null
  lastHeartbeatAtServerMillis: number | null
  households: Record<string, {
    status: HouseholdBulkItemStatus
    errorCode?: string
    errorMessage?: string
  }>
  createdAtServerMillis: number
  updatedAtServerMillis: number
}

export interface HouseholdBulkSettlementOperationView {
  operationId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  status: HouseholdBulkOperationStatus
  leaseActive: boolean
  retryable: boolean
  preSettlementCheckpointId: string | null
  households: Record<string, {
    status: HouseholdBulkItemStatus
    errorCode?: string
    errorMessage?: string
  }>
  updatedAtServerMillis: number
}

export const toHouseholdBulkSettlementOperationView = (
  op: HouseholdBulkSettlementOperation,
  nowMillis: number,
): HouseholdBulkSettlementOperationView => {
  const leaseActive = op.status === 'RUNNING' && (op.leaseExpiresAtServerMillis ?? 0) > nowMillis
  const retryable = op.status !== 'COMPLETED' && !leaseActive
  return {
    operationId: op.operationId,
    expectedRoundIndex: op.expectedRoundIndex,
    forceUnsubmitted: op.forceUnsubmitted,
    status: op.status,
    leaseActive,
    retryable,
    preSettlementCheckpointId: op.preSettlementCheckpointId,
    households: op.households,
    updatedAtServerMillis: op.updatedAtServerMillis,
  }
}

export interface CreateOrReplayBulkSettlementOperationInput {
  firestore: HouseholdFirestoreDeps['firestore']
  lessonRunId: string
  idempotencyKey: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  forceUnsubmitted: boolean
  teamIds: string[]
  nowMillis: number
}

export const createOrReplayBulkSettlementOperation = (
  input: CreateOrReplayBulkSettlementOperationInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const operationId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
    const opPath = `householdBulkSettlementOperations/${operationId}`
    const digest = requestDigest({
      lessonRunId: input.lessonRunId,
      expectedRoundIndex: input.expectedRoundIndex,
      forceUnsubmitted: input.forceUnsubmitted,
      restoreGeneration: input.restoreGeneration,
      actorUid: input.actorUid,
    })

    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (existing.exists) {
      const prior = existing.data() as unknown as HouseholdBulkSettlementOperation
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return prior
    }

    // ---- ALL WRITES AFTER ----
    const sortedTeamIds = [...input.teamIds].sort()
    const households: Record<string, { status: HouseholdBulkItemStatus }> = {}
    for (const teamId of sortedTeamIds) {
      households[teamId] = { status: 'PENDING' }
    }

    const op: HouseholdBulkSettlementOperation = {
      operationId,
      lessonRunId: input.lessonRunId,
      actorUid: input.actorUid,
      expectedRoundIndex: input.expectedRoundIndex,
      restoreGeneration: input.restoreGeneration,
      forceUnsubmitted: input.forceUnsubmitted,
      status: 'PENDING',
      preSettlementCheckpointId: null,
      requestDigest: digest,
      attempt: 0,
      leaseExpiresAtServerMillis: null,
      lastHeartbeatAtServerMillis: null,
      households,
      createdAtServerMillis: input.nowMillis,
      updatedAtServerMillis: input.nowMillis,
    }

    tx.set(opPath, op as unknown as Record<string, unknown>)
    return op
  })

export interface AcquireBulkSettlementLeaseInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  actorUid: string
  nowMillis: number
}

export const acquireBulkSettlementLease = (
  input: AcquireBulkSettlementLeaseInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    if (op.status === 'COMPLETED') {
      throw new Error('Operation is already completed')
    }

    const isLeaseActive = op.status === 'RUNNING' && (op.leaseExpiresAtServerMillis ?? 0) > input.nowMillis
    if (isLeaseActive && op.actorUid !== input.actorUid) {
      throw new Error('Active lease held by another process')
    }

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      status: 'RUNNING',
      attempt: op.attempt + 1,
      leaseExpiresAtServerMillis: input.nowMillis + HOUSEHOLD_BULK_LEASE_MS,
      lastHeartbeatAtServerMillis: input.nowMillis,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface HeartbeatBulkSettlementLeaseInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  nowMillis: number
}

export const heartbeatBulkSettlementLease = (
  input: HeartbeatBulkSettlementLeaseInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      lastHeartbeatAtServerMillis: input.nowMillis,
      leaseExpiresAtServerMillis: input.nowMillis + HOUSEHOLD_BULK_LEASE_MS,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface UpdateHouseholdBulkItemStatusInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  householdId: string
  status: HouseholdBulkItemStatus
  errorCode?: string
  errorMessage?: string
  nowMillis: number
}

export const updateHouseholdBulkItemStatus = (
  input: UpdateHouseholdBulkItemStatusInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    // ---- ALL WRITES AFTER ----
    const itemData: { status: HouseholdBulkItemStatus; errorCode?: string; errorMessage?: string } = {
      status: input.status,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {})
    }
    const updatedHouseholds = {
      ...op.households,
      [input.householdId]: itemData,
    }
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      households: updatedHouseholds,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface SetPreSettlementCheckpointIdInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  checkpointId: string
  nowMillis: number
}

export const setPreSettlementCheckpointId = (
  input: SetPreSettlementCheckpointIdInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      preSettlementCheckpointId: input.checkpointId,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface FinalizeBulkSettlementOperationInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  status: 'COMPLETED' | 'FAILED'
  nowMillis: number
}

export const finalizeBulkSettlementOperation = (
  input: FinalizeBulkSettlementOperationInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      status: input.status,
      leaseExpiresAtServerMillis: null,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export const getBulkSettlementOperationWithAdminSdk = async (
  operationId: string,
): Promise<HouseholdBulkSettlementOperation | null> => {
  const snap = await getFirestore().doc(`householdBulkSettlementOperations/${operationId}`).get()
  if (!snap.exists) return null
  return snap.data() as unknown as HouseholdBulkSettlementOperation
}

export const findActiveBulkSettlementLeaseWithAdminSdk = async (
  lessonRunId: string,
  nowMillis: number,
): Promise<HouseholdBulkSettlementOperation | null> => {
  const snap = await getFirestore()
    .collection('householdBulkSettlementOperations')
    .where('lessonRunId', '==', lessonRunId)
    .where('status', '==', 'RUNNING')
    .get()

  for (const doc of snap.docs) {
    const op = doc.data() as unknown as HouseholdBulkSettlementOperation
    if ((op.leaseExpiresAtServerMillis ?? 0) > nowMillis) {
      return op
    }
  }
  return null
}

export const findUnresolvedBulkSettlementOperationWithAdminSdk = async (
  lessonRunId: string,
): Promise<HouseholdBulkSettlementOperation | null> => {
  const snap = await getFirestore()
    .collection('householdBulkSettlementOperations')
    .where('lessonRunId', '==', lessonRunId)
    .get()

  const unresolved = snap.docs
    .map((doc) => doc.data() as unknown as HouseholdBulkSettlementOperation)
    .filter((op) => op.status !== 'COMPLETED')
    .sort((a, b) => b.updatedAtServerMillis - a.updatedAtServerMillis)

  return unresolved[0] ?? null
}
