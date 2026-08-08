import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

export type DeletionGroupStatus = 'PENDING' | 'DONE'

/** One independently-deletable resource group (a Firestore doc tree, an RTDB node, ...). */
export interface DeletionSagaGroup {
  name: string
  run: () => Promise<void>
}

export interface SagaStore {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => Promise<void>
}

interface OperationDocInProgress {
  status: 'IN_PROGRESS'
  requestDigest: string
  enumeration: unknown
  groups: Record<string, DeletionGroupStatus>
  startedAt: string
}
interface OperationDocDone {
  status: 'DONE'
  requestDigest: string
  completedAt: string
}
type OperationDoc = OperationDocInProgress | OperationDocDone

export interface RunDeletionSagaInput<Enumeration = undefined> {
  store: SagaStore
  /** Digest inputs — see requestDigest({ uid, orgId, operationKind, target, confirmedIdentifier }) below. */
  uid: string
  orgId: string
  operationKind: string
  target: string
  confirmedIdentifier: string
  idempotencyKey: string
  /**
   * Runs exactly once, the first time this operation is attempted, and its
   * result is persisted on the in-progress operation document. Retries read
   * the persisted value instead of calling this again — necessary whenever a
   * later group's identity (e.g. "which lessonRun ids to null out in RTDB")
   * depends on data that an earlier, already-completed group may have
   * already deleted.
   */
  enumerate?: () => Promise<Enumeration>
  /** Pure: must build the same group names for the same enumeration every time it's called. */
  buildGroups: (enumeration: Enumeration) => DeletionSagaGroup[]
  now?: () => Date
}

export interface RunDeletionSagaResult {
  operationId: string
  completed: boolean
  /** True if a prior call already fully completed this exact operation — no group ran again. */
  alreadyCompleted: boolean
}

export const deletionOperationPath = (orgId: string, idempotencyKey: string): string =>
  `privacyDeletionOperations/${idempotencyDocumentId(orgId, idempotencyKey)}`

/**
 * Shared idempotent multi-resource-group deletion saga (Task 12 Step 5),
 * used by both the single-resource hard-delete path and the whole-personal-
 * org purge path. A hard delete touches multiple independent resource
 * groups (Firestore doc trees, RTDB nodes) that cannot all be removed in one
 * atomic transaction — recursive Firestore deletes and cross-database
 * RTDB+Firestore writes aren't transactional together. This function
 * therefore tracks per-group completion on an operation document at
 * `privacyDeletionOperations/{idempotencyDocumentId(orgId, idempotencyKey)}`
 * so that a retry with the SAME idempotencyKey resumes and completes only
 * the groups not yet marked DONE — it never re-attempts an already-done
 * group and never skips a still-pending one.
 *
 * The operation document's digest is
 * `requestDigest({ uid, orgId, operationKind, target, confirmedIdentifier })`;
 * reusing the same idempotencyKey for a different payload is rejected before
 * any group runs. Once every group is DONE, the operation document is
 * replaced with a scrubbed `{ status: 'DONE', requestDigest, completedAt }` —
 * the digest is a one-way hash, not personal data, so an audit trail of
 * "a deletion happened" cannot itself leak who or what was deleted.
 */
export const runDeletionSaga = async <Enumeration = undefined>(
  input: RunDeletionSagaInput<Enumeration>,
): Promise<RunDeletionSagaResult> => {
  const operationId = idempotencyDocumentId(input.orgId, input.idempotencyKey)
  const operationPath = `privacyDeletionOperations/${operationId}`
  const digest = computeRequestDigest({
    uid: input.uid,
    orgId: input.orgId,
    operationKind: input.operationKind,
    target: input.target,
    confirmedIdentifier: input.confirmedIdentifier,
  })
  const now = (input.now ?? (() => new Date()))()

  const existingSnap = await input.store.get(operationPath)
  let state = existingSnap.exists ? (existingSnap.data() as unknown as OperationDoc) : undefined

  if (state !== undefined && state.requestDigest !== digest) {
    throw new Error('Idempotency key payload mismatch')
  }

  if (state?.status === 'DONE') {
    return { operationId, completed: true, alreadyCompleted: true }
  }

  if (state === undefined) {
    const enumeration = input.enumerate ? await input.enumerate() : (undefined as Enumeration)
    const initialGroups = input.buildGroups(enumeration)
    const fresh: OperationDocInProgress = {
      status: 'IN_PROGRESS',
      requestDigest: digest,
      enumeration,
      groups: Object.fromEntries(initialGroups.map((group) => [group.name, 'PENDING' as const])),
      startedAt: now.toISOString(),
    }
    await input.store.set(operationPath, fresh as unknown as Record<string, unknown>)
    state = fresh
  }

  const inProgress = state as OperationDocInProgress
  const groups = input.buildGroups(inProgress.enumeration as Enumeration)
  for (const group of groups) {
    if (inProgress.groups[group.name] === 'DONE') continue
    await group.run()
    inProgress.groups[group.name] = 'DONE'
    await input.store.set(operationPath, inProgress as unknown as Record<string, unknown>)
  }

  const scrubbed: OperationDocDone = { status: 'DONE', requestDigest: digest, completedAt: now.toISOString() }
  await input.store.set(operationPath, scrubbed as unknown as Record<string, unknown>)
  return { operationId, completed: true, alreadyCompleted: false }
}
