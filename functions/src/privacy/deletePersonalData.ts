import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { runDeletionSaga, type DeletionSagaGroup, type SagaStore } from './deletionSaga'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export interface Store {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  update: (path: string, data: Record<string, unknown>) => Promise<void>
  clearPendingDeletion: (path: string) => Promise<void>
  recursiveDelete: (path: string) => Promise<void>
}

/**
 * Normal (accidental-deletion-recovery) path: spec §21.4's "通常削除は30日間
 * 復元可能" and §21.3 priority 4 "教師の誤操作 → 30日復元". Marks the
 * document rather than deleting it. Task 12's scheduled purge reads
 * `pendingDeletion.purgeAfter` and permanently deletes it once due.
 */
export const requestSoftDelete = async (input: { store: Store; path: string; reason: string; now?: () => Date }): Promise<void> => {
  const now = (input.now ?? (() => new Date()))()
  await input.store.update(input.path, { pendingDeletion: { reason: input.reason, requestedAt: now.toISOString(), purgeAfter: new Date(now.getTime() + THIRTY_DAYS_MS).toISOString() } })
}

export const restoreSoftDeleted = async (input: { store: Store; path: string; now?: () => Date }): Promise<void> => {
  const snap = await input.store.get(input.path)
  if (!snap.exists) throw new Error('Document not found')
  const pendingDeletion = snap.data()?.pendingDeletion as { purgeAfter?: string } | undefined
  if (!pendingDeletion?.purgeAfter) throw new Error('Document is not pending deletion')
  const now = (input.now ?? (() => new Date()))()
  if (now.getTime() >= new Date(pendingDeletion.purgeAfter).getTime()) throw new Error('Restore window expired')
  await input.store.clearPendingDeletion(input.path)
}

/**
 * Formal complete-deletion path: spec §21.3 priority 1 "本人・学校からの
 * 正式な完全削除要求 → 復元期間なし" and §26-9 "正式な完全削除要求を
 * ソフト削除へ回さない" — this function must never be reached by the
 * teacher-misclick UI flow (Phase B), only by an explicit, confirmed
 * complete-deletion request.
 */
export const purgeHardDelete = async (input: { store: Store; path: string }): Promise<void> => {
  await input.store.recursiveDelete(input.path)
}

// ---------------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------------

const adminSdkStore = (): Store => {
  const db = getFirestore()
  return {
    get: async (path) => { const snap = await db.doc(path).get(); return { exists: snap.exists, data: () => snap.data() } },
    update: async (path, data) => { await db.doc(path).set(data, { merge: true }) },
    clearPendingDeletion: async (path) => { await db.doc(path).update({ pendingDeletion: FieldValue.delete() }) },
    recursiveDelete: async (path) => { await db.recursiveDelete(db.doc(path)) },
  }
}

export const requestSoftDeleteWithAdminSdk = (input: { path: string; reason: string }): Promise<void> =>
  requestSoftDelete({ store: adminSdkStore(), path: input.path, reason: input.reason })

export const restoreSoftDeletedWithAdminSdk = (input: { path: string }): Promise<void> =>
  restoreSoftDeleted({ store: adminSdkStore(), path: input.path })

const adminSagaStore = (): SagaStore => {
  const db = getFirestore()
  return {
    get: async (path) => { const snap = await db.doc(path).get(); return { exists: snap.exists, data: () => snap.data() } },
    set: async (path, data) => { await db.doc(path).set(data) },
  }
}

export type ResourceCollection = 'lessonTemplates' | 'lessonRuns'

/**
 * Single-resource hard delete, wired to the shared deletion saga (Task 12's
 * Step 5). Group order matters for resumability: the RTDB mirror groups run
 * BEFORE the Firestore recursive delete. `purgeHardDeleteCallable`'s
 * authorization re-reads the target document's own `orgId` on every call
 * (including retries), so as long as the Firestore document itself survives
 * until the very last group, a retry after a partial failure can still
 * re-authorize. Reversing this order (Firestore first) would let a
 * Firestore-succeeds/RTDB-fails retry lose the very document needed to
 * re-verify org membership.
 */
export const purgeHardDeleteResourceWithAdminSdk = async (input: {
  orgId: string
  collection: ResourceCollection
  id: string
  uid: string
  idempotencyKey: string
}): ReturnType<typeof runDeletionSaga> => {
  const db = getFirestore()
  const rtdb = getDatabase()
  const path = `${input.collection}/${input.id}`

  const groups: DeletionSagaGroup[] = []
  if (input.collection === 'lessonRuns') {
    groups.push({
      name: 'rtdb',
      run: async () => {
        await rtdb.ref().update({
          [`lessonRunPublic/${input.id}`]: null,
          [`lessonRunPrivate/${input.id}`]: null,
        })
      },
    })
  }
  groups.push({ name: 'firestore', run: async () => { await db.recursiveDelete(db.doc(path)) } })

  return runDeletionSaga({
    store: adminSagaStore(),
    uid: input.uid,
    orgId: input.orgId,
    operationKind: 'RESOURCE_PURGE',
    target: path,
    confirmedIdentifier: input.id,
    idempotencyKey: input.idempotencyKey,
    buildGroups: () => groups,
  })
}

interface PersonalOrgEnumeration {
  templateIds: string[]
  runIds: string[]
}

/**
 * Whole personal-org hard delete (spec §21.3 priority 1, formal complete
 * deletion request). Scope mirrors — and is a strict superset of —
 * exportPersonalDataWithAdminSdk's enumeration (see exportPersonalData.ts):
 * every lessonTemplate (with its versions subcollection, via
 * recursiveDelete), every lessonRun (with its events/checkpoints
 * subcollections, via recursiveDelete), the organization document and its
 * members subcollection, the user profile document, and the RTDB
 * orgAccess/orgAccessMeta mirrors plus every run's public/private RTDB
 * nodes.
 *
 * The template/run id lists are enumerated exactly once (`enumerate`) and
 * persisted on the in-progress operation document by the saga, rather than
 * re-queried on every retry — once the "lessonRuns" Firestore group has
 * completed, a live query for "runs owned by this org" would come back
 * empty, and the RTDB-mirror group would have no ids left to clean up.
 *
 * The `organization` group (which deletes `organizations/{orgId}` — the
 * document `purgePersonalOrganizationCallable` re-reads on every call to
 * verify ownerUid) is deliberately ordered LAST, for the same
 * re-authorization reason `purgeHardDeleteResourceWithAdminSdk` orders RTDB
 * before Firestore: as long as it hasn't run yet, a retried call can still
 * re-verify the caller owns this org.
 */
export const purgePersonalOrganizationWithAdminSdk = async (input: {
  uid: string
  orgId: string
  idempotencyKey: string
}): ReturnType<typeof runDeletionSaga<PersonalOrgEnumeration>> => {
  const db = getFirestore()
  const rtdb = getDatabase()
  const { uid, orgId } = input

  const enumerate = async (): Promise<PersonalOrgEnumeration> => {
    const [templatesSnap, runsSnap] = await Promise.all([
      db.collection('lessonTemplates').where('orgId', '==', orgId).get(),
      db.collection('lessonRuns').where('orgId', '==', orgId).get(),
    ])
    return {
      templateIds: templatesSnap.docs.map((doc) => doc.id),
      runIds: runsSnap.docs.map((doc) => doc.id),
    }
  }

  const buildGroups = (enumeration: PersonalOrgEnumeration): DeletionSagaGroup[] => [
    {
      name: 'lessonTemplates',
      run: async () => { await Promise.all(enumeration.templateIds.map((id) => db.recursiveDelete(db.doc(`lessonTemplates/${id}`)))) },
    },
    {
      name: 'lessonRuns',
      run: async () => { await Promise.all(enumeration.runIds.map((id) => db.recursiveDelete(db.doc(`lessonRuns/${id}`)))) },
    },
    {
      name: 'user',
      run: async () => { await db.recursiveDelete(db.doc(`users/${uid}`)) },
    },
    {
      name: 'rtdbOrgAccess',
      run: async () => { await rtdb.ref().update({ [`orgAccess/${orgId}`]: null, [`orgAccessMeta/${orgId}`]: null }) },
    },
    {
      name: 'rtdbLessonRuns',
      run: async () => {
        if (enumeration.runIds.length === 0) return
        const updates: Record<string, null> = {}
        for (const id of enumeration.runIds) {
          updates[`lessonRunPublic/${id}`] = null
          updates[`lessonRunPrivate/${id}`] = null
        }
        await rtdb.ref().update(updates)
      },
    },
    {
      name: 'organization',
      run: async () => { await db.recursiveDelete(db.doc(`organizations/${orgId}`)) },
    },
  ]

  return runDeletionSaga<PersonalOrgEnumeration>({
    store: adminSagaStore(),
    uid,
    orgId,
    operationKind: 'ORGANIZATION_PURGE',
    target: orgId,
    confirmedIdentifier: uid,
    idempotencyKey: input.idempotencyKey,
    enumerate,
    buildGroups,
  })
}
