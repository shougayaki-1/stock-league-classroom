import { describe, expect, it } from 'vitest'
import {
  acquireBulkSettlementLease,
  createOrReplayBulkSettlementOperation,
  finalizeBulkSettlementOperation,
  heartbeatBulkSettlementLease,
  HOUSEHOLD_BULK_LEASE_MS,
  setPreSettlementCheckpointId,
  toHouseholdBulkSettlementOperationView,
  updateHouseholdBulkItemStatus,
  type HouseholdBulkSettlementOperation,
} from './bulkSettlementOperation'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>): Promise<T> => {
      const written = new Set<string>()
      return fn({
        get: async (path: string) => {
          if (written.has(path)) throw new Error(`read-after-write violation: ${path}`)
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { docs.set(path, data); written.add(path) },
      })
    },
  }
}

describe('bulkSettlementOperation', () => {
  const baseInput = {
    lessonRunId: 'run-1',
    idempotencyKey: 'key-1',
    actorUid: 'teacher-1',
    expectedRoundIndex: 2,
    restoreGeneration: 0,
    forceUnsubmitted: false,
    teamIds: ['team-b', 'team-a'],
    nowMillis: 1000,
  }

  describe('createOrReplayBulkSettlementOperation', () => {
    it('creates a new operation with deterministic ID and sorted PENDING household items', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })

      expect(op.operationId).toBeTruthy()
      expect(op.status).toBe('PENDING')
      expect(op.expectedRoundIndex).toBe(2)
      expect(op.restoreGeneration).toBe(0)
      expect(op.forceUnsubmitted).toBe(false)
      expect(Object.keys(op.households)).toEqual(['team-a', 'team-b'])
      expect(op.households['team-a']).toEqual({ status: 'PENDING' })
      expect(op.households['team-b']).toEqual({ status: 'PENDING' })
    })

    it('replays same key with same payload returning existing operation', async () => {
      const fake = makeFakeFirestore()
      const first = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })
      const second = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
        nowMillis: 2000,
      })

      expect(second.operationId).toBe(first.operationId)
      expect(second.createdAtServerMillis).toBe(first.createdAtServerMillis)
    })

    it('rejects same key with different payload', async () => {
      const fake = makeFakeFirestore()
      await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })

      await expect(
        createOrReplayBulkSettlementOperation({
          firestore: fake as never,
          ...baseInput,
          expectedRoundIndex: 3,
        }),
      ).rejects.toThrow('Idempotency key payload mismatch')
    })
  })

  describe('lease management and execution', () => {
    it('acquires lease, increments attempt, and sets expiration', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })

      const acquired = await acquireBulkSettlementLease({
        firestore: fake as never,
        operationId: op.operationId,
        actorUid: 'teacher-1',
        nowMillis: 2000,
      })

      expect(acquired.status).toBe('RUNNING')
      expect(acquired.attempt).toBe(1)
      expect(acquired.leaseExpiresAtServerMillis).toBe(2000 + HOUSEHOLD_BULK_LEASE_MS)
      expect(acquired.lastHeartbeatAtServerMillis).toBe(2000)
    })

    it('blocks lease acquisition if another unexpired lease is active for different actor/attempt', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })

      await acquireBulkSettlementLease({
        firestore: fake as never,
        operationId: op.operationId,
        actorUid: 'teacher-1',
        nowMillis: 2000,
      })

      // Another actor tries to acquire while lease is still unexpired (2000 + 60000 > 3000)
      await expect(
        acquireBulkSettlementLease({
          firestore: fake as never,
          operationId: op.operationId,
          actorUid: 'teacher-2',
          nowMillis: 3000,
        }),
      ).rejects.toThrow('Active lease held by another process')
    })

    it('allows same operation expired lease reacquire after lease expiration', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })

      await acquireBulkSettlementLease({
        firestore: fake as never,
        operationId: op.operationId,
        actorUid: 'teacher-1',
        nowMillis: 2000,
      })

      const reacquired = await acquireBulkSettlementLease({
        firestore: fake as never,
        operationId: op.operationId,
        actorUid: 'teacher-1',
        nowMillis: 2000 + HOUSEHOLD_BULK_LEASE_MS + 1000,
      })

      expect(reacquired.attempt).toBe(2)
      expect(reacquired.status).toBe('RUNNING')
    })

    it('extends lease on heartbeat', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })
      await acquireBulkSettlementLease({
        firestore: fake as never,
        operationId: op.operationId,
        actorUid: 'teacher-1',
        nowMillis: 2000,
      })

      const updated = await heartbeatBulkSettlementLease({
        firestore: fake as never,
        operationId: op.operationId,
        nowMillis: 5000,
      })

      expect(updated.lastHeartbeatAtServerMillis).toBe(5000)
      expect(updated.leaseExpiresAtServerMillis).toBe(5000 + HOUSEHOLD_BULK_LEASE_MS)
    })

    it('updates item status and saves preSettlementCheckpointId', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })

      await setPreSettlementCheckpointId({
        firestore: fake as never,
        operationId: op.operationId,
        checkpointId: 'hcp-1',
        nowMillis: 3000,
      })

      await updateHouseholdBulkItemStatus({
        firestore: fake as never,
        operationId: op.operationId,
        householdId: 'team-a',
        status: 'SUCCEEDED',
        nowMillis: 4000,
      })

      const finalOp = await finalizeBulkSettlementOperation({
        firestore: fake as never,
        operationId: op.operationId,
        status: 'FAILED',
        nowMillis: 5000,
      })

      expect(finalOp.preSettlementCheckpointId).toBe('hcp-1')
      expect(finalOp.households['team-a'].status).toBe('SUCCEEDED')
      expect(finalOp.households['team-b'].status).toBe('PENDING')
      expect(finalOp.status).toBe('FAILED')
      expect(finalOp.leaseExpiresAtServerMillis).toBeNull()
    })
  })

  describe('toHouseholdBulkSettlementOperationView', () => {
    it('computes leaseActive and retryable correctly', () => {
      const op: HouseholdBulkSettlementOperation = {
        operationId: 'op-1',
        lessonRunId: 'run-1',
        actorUid: 'teacher-1',
        expectedRoundIndex: 1,
        restoreGeneration: 0,
        forceUnsubmitted: false,
        status: 'RUNNING',
        preSettlementCheckpointId: 'cp-1',
        requestDigest: 'digest-1',
        attempt: 1,
        leaseExpiresAtServerMillis: 5000,
        lastHeartbeatAtServerMillis: 1000,
        households: {
          'team-1': { status: 'SUCCEEDED' },
          'team-2': { status: 'FAILED', errorCode: 'error', errorMessage: 'msg' },
        },
        createdAtServerMillis: 1000,
        updatedAtServerMillis: 1000,
      }

      // During active lease
      const viewActive = toHouseholdBulkSettlementOperationView(op, 3000)
      expect(viewActive.leaseActive).toBe(true)
      expect(viewActive.retryable).toBe(false)

      // After lease expiration
      const viewExpired = toHouseholdBulkSettlementOperationView(op, 6000)
      expect(viewExpired.leaseActive).toBe(false)
      expect(viewExpired.retryable).toBe(true)

      // Completed
      const viewCompleted = toHouseholdBulkSettlementOperationView({ ...op, status: 'COMPLETED' }, 6000)
      expect(viewCompleted.leaseActive).toBe(false)
      expect(viewCompleted.retryable).toBe(false)
    })
  })
})
