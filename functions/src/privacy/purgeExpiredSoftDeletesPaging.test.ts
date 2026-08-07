import { beforeEach, describe, expect, it, vi } from 'vitest'
import { purgeExpiredSoftDeletesWithAdminSdk, PURGE_LIST_PAGE_SIZE } from './purgeExpiredSoftDeletes'
import { purgeHardDeleteResourceWithAdminSdk } from './deletePersonalData'

// -----------------------------------------------------------------------------
// Exercises purgeExpiredSoftDeletesWithAdminSdk's listCollectionDocs paging
// loop directly, mocking the underlying Firestore query chain. Kept in a
// separate file from purgeExpiredSoftDeletes.test.ts so its module-level
// vi.mock('firebase-admin/firestore', ...) doesn't affect the pure-function
// tests there.
//
// The mock query genuinely honors `startAfter(cursor)` and `limit(n)`: each
// collection is backed by a flat, ordered array of docs, and get() slices
// that array starting just after whatever doc id `startAfter` was last
// called with, capped at whatever `limit` was last called with. This means
// if the production loop ever forgot to call `startAfter` (or passed a
// stale/wrong cursor), get() would keep re-slicing from the same spot and
// return the same page again — exactly the "re-fetch page 1 forever"
// regression this test suite exists to catch.
// -----------------------------------------------------------------------------

interface FakeDoc { id: string; data: Record<string, unknown> }

interface QueryState {
  cursorId?: string
  limitN: number
  startAfterCalls: string[]
  getCallCount: number
}

const queryStates = new Map<string, QueryState>()

const makeQuery = (name: string, allDocs: FakeDoc[]) => {
  const state: QueryState = queryStates.get(name) ?? { limitN: allDocs.length || 1, startAfterCalls: [], getCallCount: 0 }
  queryStates.set(name, state)

  const query = {
    where: () => query,
    orderBy: () => query,
    limit: (n: number) => {
      state.limitN = n
      return query
    },
    startAfter: (docSnap: { id: string }) => {
      state.cursorId = docSnap.id
      state.startAfterCalls.push(docSnap.id)
      return query
    },
    get: async () => {
      state.getCallCount += 1
      let startIndex = 0
      if (state.cursorId !== undefined) {
        const cursorIndex = allDocs.findIndex((doc) => doc.id === state.cursorId)
        // If the cursor id isn't found, fall back to the start (mirrors a
        // real query with a stale cursor returning nothing useful) rather
        // than silently masking a "forgot to call startAfter" bug.
        startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1
      }
      const page = allDocs.slice(startIndex, startIndex + state.limitN)
      return {
        empty: page.length === 0,
        docs: page.map((doc) => ({ id: doc.id, data: () => doc.data })),
      }
    },
  }
  return query
}

const docGetMock = vi.fn()
let lessonRunDocs: FakeDoc[] = []
let lessonTemplateDocs: FakeDoc[] = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name: string) => makeQuery(name, name === 'lessonRuns' ? lessonRunDocs : lessonTemplateDocs),
    doc: () => ({ get: docGetMock }),
  }),
}))

vi.mock('./deletePersonalData', () => ({
  purgeHardDeleteResourceWithAdminSdk: vi.fn().mockResolvedValue({ operationId: 'op-1', completed: true, alreadyCompleted: false }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  queryStates.clear()
  lessonRunDocs = []
  lessonTemplateDocs = []
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
    lessonRunDocs = [...page1, ...page2]

    const result = await purgeExpiredSoftDeletesWithAdminSdk()

    expect(result.failed).toEqual([])
    expect(result.purged).toHaveLength(PURGE_LIST_PAGE_SIZE + 2)
    expect(result.purged).toContain('lessonRuns/run-0')
    expect(result.purged).toContain(`lessonRuns/run-${PURGE_LIST_PAGE_SIZE - 1}`)
    expect(result.purged).toContain('lessonRuns/run-extra-1')
    expect(result.purged).toContain('lessonRuns/run-extra-2')
    expect(purgeHardDeleteResourceWithAdminSdk).toHaveBeenCalledTimes(PURGE_LIST_PAGE_SIZE + 2)

    // No document should ever be processed twice. If the production loop
    // forgot to call startAfter (or passed a stale cursor), the mock would
    // keep re-slicing from the start of lessonRunDocs and this would fail —
    // either via a duplicate id here, or via the loop never terminating
    // (each "page" would keep coming back full-size, so it would never hit
    // the short-page break condition).
    expect(new Set(result.purged).size).toBe(result.purged.length)

    // Directly pin down that startAfter was actually threaded through with
    // the real last-doc cursor from the previous page, not just called with
    // *something*. This is the assertion that would catch a `startAfter`
    // call sites deleted or fed the wrong doc.
    const state = queryStates.get('lessonRuns')
    // startAfter is called once, going into the second (and final) page —
    // the loop stops as soon as it sees a short page, so there's no third
    // round-trip and thus no second startAfter call.
    expect(state?.startAfterCalls).toEqual([`run-${PURGE_LIST_PAGE_SIZE - 1}`])

    // limit() should have been honored: every page actually fetched must be
    // capped at PURGE_LIST_PAGE_SIZE docs (verified indirectly above via
    // result length, but assert the mock's recorded limit directly too).
    expect(state?.limitN).toBe(PURGE_LIST_PAGE_SIZE)
    expect(state?.getCallCount).toBe(2) // one full page, then one short page that stops the loop
  })

  it('stops paging once a page comes back short of the page size', async () => {
    lessonRunDocs = [{ id: 'run-1', data: { pendingDeletion: { purgeAfter: '2020-01-01T00:00:00.000Z' } } }]

    const result = await purgeExpiredSoftDeletesWithAdminSdk()

    expect(result.purged).toEqual(['lessonRuns/run-1'])
    expect(purgeHardDeleteResourceWithAdminSdk).toHaveBeenCalledTimes(1)
    // Exactly one get() call should have happened for lessonRuns: the single
    // page returned (length 1) is already short of PURGE_LIST_PAGE_SIZE, so
    // the loop must stop without an extra round-trip to confirm emptiness.
    expect(queryStates.get('lessonRuns')?.getCallCount).toBe(1)
  })
})
