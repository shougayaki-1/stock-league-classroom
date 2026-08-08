import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { purgeHardDeleteResourceWithAdminSdk, purgePersonalOrganizationWithAdminSdk } from './deletePersonalData'

// -----------------------------------------------------------------------------
// This file exercises purgeHardDeleteResourceWithAdminSdk and
// purgePersonalOrganizationWithAdminSdk directly — the two functions in
// deletePersonalData.ts that define WHAT gets deleted (exact Firestore paths
// passed to recursiveDelete, exact RTDB update payloads, and group ordering).
// Neither function has an existing dependency-injection seam (they call
// getFirestore()/getDatabase() directly), so — following the precedent in
// lessonRuns/onCall.test.ts and privacy/onCall.test.ts of module-level
// vi.mock('firebase-admin/firestore', ...) — this file intercepts the
// firebase-admin/firestore and firebase-admin/database modules themselves
// rather than adding a new seam, which would touch the saga/production code
// for no behavioral benefit.
// -----------------------------------------------------------------------------

const operationDocs = new Map<string, Record<string, unknown>>()
const recursiveDeleteMock = vi.fn(async (_ref: { path: string }) => {})
const collectionResults = new Map<string, string[]>()

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: operationDocs.has(path), data: () => operationDocs.get(path) }),
      set: async (data: Record<string, unknown>) => { operationDocs.set(path, data) },
    }),
    recursiveDelete: (ref: { path: string }) => recursiveDeleteMock(ref),
    collection: (name: string) => ({
      where: () => ({
        get: async () => ({ docs: (collectionResults.get(name) ?? []).map((id) => ({ id })) }),
      }),
    }),
  }),
  FieldValue: { delete: () => 'FIELD_DELETE_SENTINEL' },
}))

const rtdbUpdateMock = vi.fn(async (_updates: Record<string, unknown>) => {})

vi.mock('firebase-admin/database', () => ({
  getDatabase: () => ({ ref: () => ({ update: rtdbUpdateMock }) }),
}))

beforeEach(() => {
  operationDocs.clear()
  collectionResults.clear()
  recursiveDeleteMock.mockClear()
  rtdbUpdateMock.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('purgeHardDeleteResourceWithAdminSdk', () => {
  it('recursively deletes the lessonRuns/{id} Firestore tree and nulls both RTDB mirrors for a lessonRun target', async () => {
    const result = await purgeHardDeleteResourceWithAdminSdk({
      orgId: 'personal_teacher-a',
      collection: 'lessonRuns',
      id: 'run-1',
      uid: 'teacher-a',
      idempotencyKey: 'key-1',
    })

    expect(result.completed).toBe(true)

    // Exactly one recursiveDelete call, targeting the run doc (its
    // events/checkpoints subcollections are covered implicitly by
    // recursiveDelete's own semantics — not re-tested here).
    expect(recursiveDeleteMock).toHaveBeenCalledTimes(1)
    expect(recursiveDeleteMock.mock.calls[0][0].path).toBe('lessonRuns/run-1')

    // Both RTDB mirrors nulled in a single update call.
    expect(rtdbUpdateMock).toHaveBeenCalledTimes(1)
    expect(rtdbUpdateMock).toHaveBeenCalledWith({
      'lessonRunPublic/run-1': null,
      'lessonRunPrivate/run-1': null,
    })
  })

  it('does not touch RTDB for a lessonTemplates target (no public/private mirror exists for templates)', async () => {
    await purgeHardDeleteResourceWithAdminSdk({
      orgId: 'personal_teacher-a',
      collection: 'lessonTemplates',
      id: 'template-1',
      uid: 'teacher-a',
      idempotencyKey: 'key-2',
    })

    expect(recursiveDeleteMock).toHaveBeenCalledTimes(1)
    expect(recursiveDeleteMock.mock.calls[0][0].path).toBe('lessonTemplates/template-1')
    expect(rtdbUpdateMock).not.toHaveBeenCalled()
  })
})

describe('purgePersonalOrganizationWithAdminSdk', () => {
  it('recursively deletes every enumerated template/run plus users/{uid}, deletes organizations/{orgId} LAST, and nulls all RTDB mirrors', async () => {
    collectionResults.set('lessonTemplates', ['t1', 't2'])
    collectionResults.set('lessonRuns', ['r1', 'r2'])

    const result = await purgePersonalOrganizationWithAdminSdk({
      uid: 'teacher-a',
      orgId: 'personal_teacher-a',
      idempotencyKey: 'org-key-1',
    })

    expect(result.completed).toBe(true)

    const deletedPaths = recursiveDeleteMock.mock.calls.map((call) => call[0].path)
    expect(deletedPaths).toEqual([
      'lessonTemplates/t1',
      'lessonTemplates/t2',
      'lessonRuns/r1',
      'lessonRuns/r2',
      'users/teacher-a',
      'organizations/personal_teacher-a',
    ])
    // Deliberate ordering: organizations/{orgId} — the doc re-read for
    // re-authorization on every retry — must be deleted LAST.
    expect(deletedPaths.at(-1)).toBe('organizations/personal_teacher-a')

    expect(rtdbUpdateMock).toHaveBeenCalledWith({
      'orgAccess/personal_teacher-a': null,
      'orgAccessMeta/personal_teacher-a': null,
    })
    expect(rtdbUpdateMock).toHaveBeenCalledWith({
      'lessonRunPublic/r1': null,
      'lessonRunPrivate/r1': null,
      'lessonRunPublic/r2': null,
      'lessonRunPrivate/r2': null,
    })
  })

  it('skips the RTDB lessonRuns null-write entirely when the org has no runs', async () => {
    collectionResults.set('lessonTemplates', [])
    collectionResults.set('lessonRuns', [])

    await purgePersonalOrganizationWithAdminSdk({
      uid: 'teacher-b',
      orgId: 'personal_teacher-b',
      idempotencyKey: 'org-key-2',
    })

    // Only the orgAccess/orgAccessMeta update should have happened.
    expect(rtdbUpdateMock).toHaveBeenCalledTimes(1)
    expect(rtdbUpdateMock).toHaveBeenCalledWith({
      'orgAccess/personal_teacher-b': null,
      'orgAccessMeta/personal_teacher-b': null,
    })

    const deletedPaths = recursiveDeleteMock.mock.calls.map((call) => call[0].path)
    expect(deletedPaths).toEqual(['users/teacher-b', 'organizations/personal_teacher-b'])
  })
})
