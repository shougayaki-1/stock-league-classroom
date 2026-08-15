import { describe, expect, it } from 'vitest'
import {
  acquireBulkSettlementLease,
  cancelBulkSettlementOperation,
  createOrReplayBulkSettlementOperation,
  createOrReplayBulkSettlementOperationWithControlLock,
  finalizeBulkSettlementOperation,
  heartbeatBulkSettlementLease,
  HOUSEHOLD_BULK_LEASE_MS,
  setPreSettlementCheckpointId,
  toHouseholdBulkSettlementOperationView,
  updateHouseholdBulkItemStatus,
  type HouseholdBulkSettlementOperation,
  type HouseholdBulkTarget,
} from './bulkSettlementOperation'
import type { HouseholdRuntimeControl } from './statusTransition'

const makeFakeFirestore = (initialDocs: Record<string, Record<string, unknown>> = {}) => {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(initialDocs))
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

const baseTargets: HouseholdBulkTarget[] = [
  { householdId: 'team-b', teamId: 'team-b', profileId: 'profile-b' },
  { householdId: 'team-a', teamId: 'team-a', profileId: 'profile-a' },
]

describe('bulkSettlementOperation', () => {
  const baseInput = {
    lessonRunId: 'run-1',
    idempotencyKey: 'key-1',
    actorUid: 'teacher-1',
    expectedRoundIndex: 2,
    restoreGeneration: 0,
    assignmentRevision: null as number | null,
    forceUnsubmitted: false,
    targets: baseTargets,
    nowMillis: 1000,
  }

  describe('createOrReplayBulkSettlementOperation', () => {
    it('creates a new operation with deterministic ID and sorted PENDING household items, carrying teamId/profileId', async () => {
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
      expect(op.assignmentRevision).toBeNull()
      expect(Object.keys(op.households)).toEqual(['team-a', 'team-b'])
      expect(op.households['team-a']).toEqual({ status: 'PENDING', teamId: 'team-a', profileId: 'profile-a' })
      expect(op.households['team-b']).toEqual({ status: 'PENDING', teamId: 'team-b', profileId: 'profile-b' })
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

    it('rejects same key with a different target set (e.g. the team roster changed between the first attempt and a retry)', async () => {
      const fake = makeFakeFirestore()
      await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
      })

      await expect(
        createOrReplayBulkSettlementOperation({
          firestore: fake as never,
          ...baseInput,
          targets: [
            ...baseTargets,
            { householdId: 'team-c', teamId: 'team-c', profileId: 'profile-c' },
          ],
        }),
      ).rejects.toThrow('Idempotency key payload mismatch')
    })

    it('accepts a replay whose targets are the same set in a different array order (digest sorts by householdId)', async () => {
      const fake = makeFakeFirestore()
      const first = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
        targets: baseTargets,
      })

      const second = await createOrReplayBulkSettlementOperation({
        firestore: fake as never,
        ...baseInput,
        targets: [...baseTargets].reverse(),
      })

      expect(second.operationId).toBe(first.operationId)
    })
  })

  describe('createOrReplayBulkSettlementOperationWithControlLock (advanced formats)', () => {
    const controlPath = 'lessonRuns/run-1/householdRuntime/control'
    const openControl: HouseholdRuntimeControl = {
      courseFormat: 'ROLE_VARIANT',
      assignmentRevision: 5,
      synchronizedRoundIndex: 2,
      roundStatus: 'OPEN',
      activeOperationId: null,
      updatedAtServerMillis: 500,
    }

    const lockedInput = {
      lessonRunId: 'run-1',
      idempotencyKey: 'key-1',
      actorUid: 'teacher-1',
      expectedRoundIndex: 2,
      restoreGeneration: 0,
      assignmentRevision: 5,
      forceUnsubmitted: false,
      targets: baseTargets,
      nowMillis: 1000,
    }

    it('atomically creates the operation AND flips the control document to SETTLING when OPEN + matching revision/round', async () => {
      const fake = makeFakeFirestore({ [controlPath]: openControl as unknown as Record<string, unknown> })

      const op = await createOrReplayBulkSettlementOperationWithControlLock({
        firestore: fake as never,
        ...lockedInput,
      })

      expect(op.status).toBe('PENDING')
      expect(op.assignmentRevision).toBe(5)

      const control = fake.docs.get(controlPath) as unknown as HouseholdRuntimeControl
      expect(control.roundStatus).toBe('SETTLING')
      expect(control.activeOperationId).toBe(op.operationId)
    })

    it('rejects and creates nothing when the control document is not OPEN', async () => {
      const fake = makeFakeFirestore({
        [controlPath]: { ...openControl, roundStatus: 'SETTLING', activeOperationId: 'other-op' } as unknown as Record<string, unknown>,
      })

      await expect(
        createOrReplayBulkSettlementOperationWithControlLock({ firestore: fake as never, ...lockedInput }),
      ).rejects.toThrow('not OPEN')

      // No new operation doc was written — only the pre-existing control doc key remains.
      expect([...fake.docs.keys()]).toEqual([controlPath])
    })

    it('rejects on assignmentRevision mismatch without writing anything', async () => {
      const fake = makeFakeFirestore({ [controlPath]: openControl as unknown as Record<string, unknown> })

      await expect(
        createOrReplayBulkSettlementOperationWithControlLock({
          firestore: fake as never,
          ...lockedInput,
          assignmentRevision: 999,
        }),
      ).rejects.toThrow('assignmentRevision')

      expect([...fake.docs.keys()]).toEqual([controlPath])
    })

    it('rejects on synchronizedRoundIndex mismatch without writing anything', async () => {
      const fake = makeFakeFirestore({ [controlPath]: openControl as unknown as Record<string, unknown> })

      await expect(
        createOrReplayBulkSettlementOperationWithControlLock({
          firestore: fake as never,
          ...lockedInput,
          expectedRoundIndex: 99,
        }),
      ).rejects.toThrow('synchronizedRoundIndex')

      expect([...fake.docs.keys()]).toEqual([controlPath])
    })

    it('rejects same key with a different target set (e.g. the team roster changed between the first attempt and a retry)', async () => {
      const fake = makeFakeFirestore({ [controlPath]: openControl as unknown as Record<string, unknown> })
      await createOrReplayBulkSettlementOperationWithControlLock({ firestore: fake as never, ...lockedInput })

      await expect(
        createOrReplayBulkSettlementOperationWithControlLock({
          firestore: fake as never,
          ...lockedInput,
          targets: [
            ...baseTargets,
            { householdId: 'team-c', teamId: 'team-c', profileId: 'profile-c' },
          ],
        }),
      ).rejects.toThrow('Idempotency key payload mismatch')
    })

    it('replaying the same idempotencyKey does not re-touch the control document', async () => {
      const fake = makeFakeFirestore({ [controlPath]: openControl as unknown as Record<string, unknown> })
      const first = await createOrReplayBulkSettlementOperationWithControlLock({ firestore: fake as never, ...lockedInput })

      // Simulate the control doc having since moved on (e.g. finalize already unlocked it).
      fake.docs.set(controlPath, { ...openControl, roundStatus: 'OPEN', activeOperationId: null, synchronizedRoundIndex: 3 })

      const replayed = await createOrReplayBulkSettlementOperationWithControlLock({ firestore: fake as never, ...lockedInput })
      expect(replayed.operationId).toBe(first.operationId)
      // Control doc is exactly what we set it to above — untouched by the replay.
      expect(fake.docs.get(controlPath)).toEqual({ ...openControl, roundStatus: 'OPEN', activeOperationId: null, synchronizedRoundIndex: 3 })
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

    it('rejects lease acquisition on an already-completed operation', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({ firestore: fake as never, ...baseInput })
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-a', status: 'SUCCEEDED', nowMillis: 1500 })
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-b', status: 'SUCCEEDED', nowMillis: 1500 })
      await finalizeBulkSettlementOperation({ firestore: fake as never, operationId: op.operationId, status: 'COMPLETED', nowMillis: 1600 })

      await expect(
        acquireBulkSettlementLease({ firestore: fake as never, operationId: op.operationId, actorUid: 'teacher-1', nowMillis: 2000 }),
      ).rejects.toThrow('already completed')
    })

    it('rejects lease acquisition on a CANCELLED operation', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({ firestore: fake as never, ...baseInput })
      await cancelBulkSettlementOperation({ firestore: fake as never, operationId: op.operationId, nowMillis: 1600 })

      await expect(
        acquireBulkSettlementLease({ firestore: fake as never, operationId: op.operationId, actorUid: 'teacher-1', nowMillis: 2000 }),
      ).rejects.toThrow('already cancelled')
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

    it('updates item status (preserving teamId/profileId) and saves preSettlementCheckpointId', async () => {
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
      expect(finalOp.households['team-a']).toEqual({ status: 'SUCCEEDED', teamId: 'team-a', profileId: 'profile-a' })
      expect(finalOp.households['team-b']).toEqual({ status: 'PENDING', teamId: 'team-b', profileId: 'profile-b' })
      expect(finalOp.status).toBe('FAILED')
      expect(finalOp.leaseExpiresAtServerMillis).toBeNull()
    })
  })

  describe('finalizeBulkSettlementOperation control-document unlock (advanced formats)', () => {
    const controlPath = 'lessonRuns/run-1/householdRuntime/control'
    const lockedControl: HouseholdRuntimeControl = {
      courseFormat: 'ROLE_VARIANT',
      assignmentRevision: 5,
      synchronizedRoundIndex: 2,
      roundStatus: 'SETTLING',
      activeOperationId: '',
      updatedAtServerMillis: 900,
    }

    const setUpLockedOperation = async () => {
      const fake = makeFakeFirestore({ [controlPath]: { ...lockedControl, roundStatus: 'OPEN', activeOperationId: null } as unknown as Record<string, unknown> })
      const op = await createOrReplayBulkSettlementOperationWithControlLock({
        firestore: fake as never,
        lessonRunId: 'run-1',
        idempotencyKey: 'key-1',
        actorUid: 'teacher-1',
        expectedRoundIndex: 2,
        restoreGeneration: 0,
        assignmentRevision: 5,
        forceUnsubmitted: false,
        targets: baseTargets,
        nowMillis: 1000,
      })
      return { fake, op }
    }

    it('completion: all items successful -> operation COMPLETED + control OPEN + activeOperationId null + synchronizedRoundIndex N+1, atomically', async () => {
      const { fake, op } = await setUpLockedOperation()
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-a', status: 'SUCCEEDED', nowMillis: 1100 })
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-b', status: 'SUCCEEDED', nowMillis: 1100 })

      const finalized = await finalizeBulkSettlementOperation({ firestore: fake as never, operationId: op.operationId, status: 'COMPLETED', nowMillis: 2000 })
      expect(finalized.status).toBe('COMPLETED')

      const control = fake.docs.get(controlPath) as unknown as HouseholdRuntimeControl
      expect(control.roundStatus).toBe('OPEN')
      expect(control.activeOperationId).toBeNull()
      expect(control.synchronizedRoundIndex).toBe(3)
    })

    it('partial failure: control stays SETTLING at the SAME round — the lock is NOT released and the round is NOT advanced', async () => {
      const { fake, op } = await setUpLockedOperation()
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-a', status: 'SUCCEEDED', nowMillis: 1100 })
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-b', status: 'FAILED', errorCode: 'EXECUTION_ERROR', errorMessage: 'boom', nowMillis: 1100 })

      const finalized = await finalizeBulkSettlementOperation({ firestore: fake as never, operationId: op.operationId, status: 'FAILED', nowMillis: 2000 })
      expect(finalized.status).toBe('FAILED')
      expect(finalized.households['team-a'].status).toBe('SUCCEEDED')

      const control = fake.docs.get(controlPath) as unknown as HouseholdRuntimeControl
      expect(control.roundStatus).toBe('SETTLING')
      expect(control.activeOperationId).toBe(op.operationId)
      expect(control.synchronizedRoundIndex).toBe(2)
    })

    it('never touches the control document for COMMON_CONDITIONS (assignmentRevision null)', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({ firestore: fake as never, ...baseInput })
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-a', status: 'SUCCEEDED', nowMillis: 1100 })
      await updateHouseholdBulkItemStatus({ firestore: fake as never, operationId: op.operationId, householdId: 'team-b', status: 'SUCCEEDED', nowMillis: 1100 })

      await finalizeBulkSettlementOperation({ firestore: fake as never, operationId: op.operationId, status: 'COMPLETED', nowMillis: 2000 })

      expect(fake.docs.has(controlPath)).toBe(false)
    })
  })

  describe('cancelBulkSettlementOperation (preflight-cancel)', () => {
    const controlPath = 'lessonRuns/run-1/householdRuntime/control'
    const openControl: HouseholdRuntimeControl = {
      courseFormat: 'ROLE_VARIANT',
      assignmentRevision: 5,
      synchronizedRoundIndex: 2,
      roundStatus: 'OPEN',
      activeOperationId: null,
      updatedAtServerMillis: 500,
    }

    it('CANCELLED terminal status releases the control-document lock without advancing the round', async () => {
      const fake = makeFakeFirestore({ [controlPath]: openControl as unknown as Record<string, unknown> })
      const op = await createOrReplayBulkSettlementOperationWithControlLock({
        firestore: fake as never,
        lessonRunId: 'run-1',
        idempotencyKey: 'key-1',
        actorUid: 'teacher-1',
        expectedRoundIndex: 2,
        restoreGeneration: 0,
        assignmentRevision: 5,
        forceUnsubmitted: false,
        targets: baseTargets,
        nowMillis: 1000,
      })

      const cancelled = await cancelBulkSettlementOperation({ firestore: fake as never, operationId: op.operationId, nowMillis: 2000 })
      expect(cancelled.status).toBe('CANCELLED')
      expect(cancelled.leaseExpiresAtServerMillis).toBeNull()

      const control = fake.docs.get(controlPath) as unknown as HouseholdRuntimeControl
      expect(control.roundStatus).toBe('OPEN')
      expect(control.activeOperationId).toBeNull()
      expect(control.synchronizedRoundIndex).toBe(2) // unchanged — nothing was actually settled
    })

    it('never touches the control document for COMMON_CONDITIONS (assignmentRevision null)', async () => {
      const fake = makeFakeFirestore()
      const op = await createOrReplayBulkSettlementOperation({ firestore: fake as never, ...baseInput })

      const cancelled = await cancelBulkSettlementOperation({ firestore: fake as never, operationId: op.operationId, nowMillis: 2000 })
      expect(cancelled.status).toBe('CANCELLED')
      expect(fake.docs.has(controlPath)).toBe(false)
    })

    it('is unresolved: false and retryable: false after cancellation (terminal, not retryable)', () => {
      const op: HouseholdBulkSettlementOperation = {
        operationId: 'op-1', lessonRunId: 'run-1', actorUid: 'teacher-1', expectedRoundIndex: 1,
        restoreGeneration: 0, assignmentRevision: 5, forceUnsubmitted: false, status: 'CANCELLED',
        preSettlementCheckpointId: null, requestDigest: 'd', attempt: 1, leaseExpiresAtServerMillis: null,
        lastHeartbeatAtServerMillis: null, households: {}, createdAtServerMillis: 1000, updatedAtServerMillis: 1000,
      }
      const view = toHouseholdBulkSettlementOperationView(op, 5000)
      expect(view.status).toBe('CANCELLED')
      expect(view.retryable).toBe(false)
      expect(view.leaseActive).toBe(false)
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
        assignmentRevision: null,
        forceUnsubmitted: false,
        status: 'RUNNING',
        preSettlementCheckpointId: 'cp-1',
        requestDigest: 'digest-1',
        attempt: 1,
        leaseExpiresAtServerMillis: 5000,
        lastHeartbeatAtServerMillis: 1000,
        households: {
          'team-1': { status: 'SUCCEEDED', teamId: 'team-1', profileId: 'profile-1' },
          'team-2': { status: 'FAILED', teamId: 'team-2', profileId: 'profile-2', errorCode: 'error', errorMessage: 'msg' },
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
