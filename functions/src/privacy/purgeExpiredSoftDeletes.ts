import { getFirestore } from 'firebase-admin/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import { purgeHardDeleteResourceWithAdminSdk, type ResourceCollection } from './deletePersonalData'

/**
 * spec §21.4's 30-day soft-delete window (§21.3 priority 4): a document is
 * due for permanent deletion once `now` is at or past its
 * `pendingDeletion.purgeAfter` deadline. Exposed standalone so the exact
 * boundary condition — not-yet-due excluded, exactly-at-deadline included —
 * is independently unit-testable.
 */
export const isPastPurgeDeadline = (pendingDeletion: { purgeAfter?: string } | undefined, now: Date): boolean => {
  if (!pendingDeletion?.purgeAfter) return false
  return now.getTime() >= new Date(pendingDeletion.purgeAfter).getTime()
}

export interface ScheduledPurgeStore {
  listCollectionDocs: (collection: ResourceCollection) => Promise<Array<{ id: string; data: Record<string, unknown> }>>
  purgeResource: (collection: ResourceCollection, id: string) => Promise<void>
}

export interface PurgeExpiredSoftDeletesResult { purged: string[]; failed: string[] }

const RESOURCE_COLLECTIONS: ResourceCollection[] = ['lessonTemplates', 'lessonRuns']

/**
 * Page size for the scheduled sweep's due-document listing query (Task 12
 * Step 6's "ページングし" requirement). An unbounded `.get()` over
 * lessonTemplates/lessonRuns would issue one huge query as the number of due
 * documents grows without bound; this caps each round-trip and cursors
 * through with `.startAfter(lastDoc)` until a page comes back short.
 */
export const PURGE_LIST_PAGE_SIZE = 500

/**
 * Daily scheduled sweep (Task 12 Step 6): pages through `lessonTemplates`
 * and `lessonRuns`, permanently purging every document whose
 * `pendingDeletion.purgeAfter` deadline has arrived, via the same deletion
 * saga the manual hard-delete Callables use — so an interrupted purge here
 * resumes exactly the way a manual retry would.
 *
 * A failure on one document is recorded and does NOT abort the run — every
 * other due document is still attempted. Re-running for a document already
 * fully purged in a prior run is a safe no-op: `listCollectionDocs` is
 * expected to be a live query (see `purgeExpiredSoftDeletesWithAdminSdk`)
 * that simply no longer returns a document once it's gone, and even if it
 * did, the underlying saga's own idempotent-resume behavior
 * (`runDeletionSaga`) makes a repeat attempt on an already-completed
 * operation a safe no-op rather than an error.
 */
export const purgeExpiredSoftDeletes = async (deps: {
  store: ScheduledPurgeStore
  now?: () => Date
  onFailure?: (target: string, error: unknown) => void
}): Promise<PurgeExpiredSoftDeletesResult> => {
  const now = (deps.now ?? (() => new Date()))()
  const purged: string[] = []
  const failed: string[] = []

  for (const collection of RESOURCE_COLLECTIONS) {
    const docs = await deps.store.listCollectionDocs(collection)
    for (const doc of docs) {
      const pendingDeletion = doc.data.pendingDeletion as { purgeAfter?: string } | undefined
      if (!isPastPurgeDeadline(pendingDeletion, now)) continue
      const target = `${collection}/${doc.id}`
      try {
        await deps.store.purgeResource(collection, doc.id)
        purged.push(target)
      } catch (error) {
        failed.push(target)
        deps.onFailure?.(target, error)
      }
    }
  }

  return { purged, failed }
}

/**
 * Production wiring: queries each collection for documents at or past their
 * purge deadline, and purges each via the shared Admin-SDK-wired single-
 * resource saga. The idempotencyKey is deterministic per document
 * (`scheduled-purge:{collection}/{id}`) so a repeated daily run for the same
 * still-pending document resumes the same saga operation rather than
 * starting a new, unrelated one.
 */
export const purgeExpiredSoftDeletesWithAdminSdk = (): Promise<PurgeExpiredSoftDeletesResult> => {
  const db = getFirestore()
  const store: ScheduledPurgeStore = {
    listCollectionDocs: async (collection) => {
      const nowIso = new Date().toISOString()
      const results: Array<{ id: string; data: Record<string, unknown> }> = []
      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined
      for (;;) {
        let query = db.collection(collection)
          .where('pendingDeletion.purgeAfter', '<=', nowIso)
          .orderBy('pendingDeletion.purgeAfter')
          .limit(PURGE_LIST_PAGE_SIZE)
        if (lastDoc) query = query.startAfter(lastDoc)
        const snap = await query.get()
        if (snap.empty) break
        for (const doc of snap.docs) results.push({ id: doc.id, data: doc.data() })
        lastDoc = snap.docs[snap.docs.length - 1]
        if (snap.docs.length < PURGE_LIST_PAGE_SIZE) break
      }
      return results
    },
    purgeResource: async (collection, id) => {
      const snap = await db.doc(`${collection}/${id}`).get()
      if (!snap.exists) return // already fully purged by a prior run — safe no-op
      const orgId = snap.get('orgId') as string
      await purgeHardDeleteResourceWithAdminSdk({
        orgId, collection, id,
        uid: 'system:scheduled-purge',
        idempotencyKey: `scheduled-purge:${collection}/${id}`,
      })
    },
  }
  return purgeExpiredSoftDeletes({
    store,
    onFailure: (target, error) => { logger.error(`purgeExpiredSoftDeletes failed for ${target}`, error) },
  })
}

/**
 * Production activation of this schedule is gated on Task 13 (Blaze plan) —
 * this exports the Function definition per Task 12's scope, but flipping it
 * on for real is out of scope here.
 */
export const purgeExpiredSoftDeletesScheduled = onSchedule(
  { schedule: 'every day 03:00', timeZone: 'Asia/Tokyo', region: 'asia-northeast1' },
  async () => { await purgeExpiredSoftDeletesWithAdminSdk() },
)
