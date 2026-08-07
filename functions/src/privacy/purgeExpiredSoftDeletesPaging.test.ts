import { beforeEach, describe, expect, it, vi } from 'vitest'
import { purgeExpiredSoftDeletesWithAdminSdk, PURGE_LIST_PAGE_SIZE } from './purgeExpiredSoftDeletes'
import { purgeHardDeleteResourceWithAdminSdk } from './deletePersonalData'

// -----------------------------------------------------------------------------
// Exercises purgeExpiredSoftDeletesWithAdminSdk's listCollectionDocs paging
// loop directly, mocking the underlying Firestore query chain. Kept in a
// separate file from purgeExpiredSoftDeletes.test.ts so its module-level
// vi.mock('firebase-admin/firestore', ...) doesn't affect the pure-function
// tests there.
// -----------------------------------------------------------------------------

interface FakeDoc { id: string; data: Record<string, unknown> }

/**
 * A fluent query stub: where/orderBy/limit/startAfter all return itself;
 * get() serves the next page each call. The cursor lives in `cursorByName`,
 * keyed by collection name, because the production code calls
 * `db.collection(name)` fresh on every loop iteration (to rebuild the query
 * with `.startAfter(lastDoc)`) — a per-call-local cursor would reset to page
 * 0 every iteration and loop forever.
 */
const cursorByName = new Map<string, number>()
const makeQuery = (name: string, pages: FakeDoc[][]) => {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    startAfter: () => query,
    get: async () => {
      const callIndex = cursorByName.get(name) ?? 0
      cursorByName.set(name, callIndex + 1)
      const page = pages[callIndex] ?? []
      return {
        empty: page.length === 0,
        docs: page.map((doc) => ({ id: doc.id, data: () => doc.data })),
      }
    },
  }
  return query
}

const docGetMock = vi.fn()
let lessonRunPages: FakeDoc[][] = []
let lessonTemplatePages: FakeDoc[][] = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name: string) => makeQuery(name, name === 'lessonRuns' ? lessonRunPages : lessonTemplatePages),
    doc: () => ({ get: docGetMock }),
  }),
}))

vi.mock('./deletePersonalData', () => ({
  purgeHardDeleteResourceWithAdminSdk: vi.fn().mockResolvedValue({ operationId: 'op-1', completed: true, alreadyCompleted: false }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  cursorByName.clear()
  lessonRunPages = []
  lessonTemplatePages = [[]]
  docGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'orgId' ? 'org-x' : undefined) })
})

describe('purgeExpiredSoftDeletesWithAdminSdk paging', () => {
  it('pages through more due documents than fit in a single page, processing every one', async () => {
    const purgeAfter = '2020-01-01T00:00:00.000Z'
    const page1 = Array.from({ length: PURGE_LIST_PAGE_SIZE }, (_, i) => ({
      id: `run-${i}`,
      data: { pendingDeletion: { purgeAfter } },
    }))
    const page2 = [
      { id: 'run-extra-1', data: { pendingDeletion: { purgeAfter } } },
      { id: 'run-extra-2', data: { pendingDeletion: { purgeAfter } } },
    ]
    lessonRunPages = [page1, page2, []]

    const result = await purgeExpiredSoftDeletesWithAdminSdk()

    expect(result.failed).toEqual([])
    expect(result.purged).toHaveLength(PURGE_LIST_PAGE_SIZE + 2)
    expect(result.purged).toContain('lessonRuns/run-0')
    expect(result.purged).toContain(`lessonRuns/run-${PURGE_LIST_PAGE_SIZE - 1}`)
    expect(result.purged).toContain('lessonRuns/run-extra-1')
    expect(result.purged).toContain('lessonRuns/run-extra-2')
    expect(purgeHardDeleteResourceWithAdminSdk).toHaveBeenCalledTimes(PURGE_LIST_PAGE_SIZE + 2)
  })

  it('stops paging once a page comes back short of the page size', async () => {
    lessonRunPages = [[{ id: 'run-1', data: { pendingDeletion: { purgeAfter: '2020-01-01T00:00:00.000Z' } } }]]

    const result = await purgeExpiredSoftDeletesWithAdminSdk()

    expect(result.purged).toEqual(['lessonRuns/run-1'])
    // Only one get() call should have happened for lessonRuns (page short of PURGE_LIST_PAGE_SIZE).
    expect(purgeHardDeleteResourceWithAdminSdk).toHaveBeenCalledTimes(1)
  })
})
