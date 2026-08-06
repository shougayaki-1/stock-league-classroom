import { describe, expect, it, vi } from 'vitest'
import { isPastPurgeDeadline, purgeExpiredSoftDeletes, type ScheduledPurgeStore } from './purgeExpiredSoftDeletes'

describe('isPastPurgeDeadline', () => {
  const now = new Date('2026-09-04T00:00:00.000Z')

  it('is false when pendingDeletion is missing entirely', () => {
    expect(isPastPurgeDeadline(undefined, now)).toBe(false)
  })

  it('is false before the deadline', () => {
    expect(isPastPurgeDeadline({ purgeAfter: '2026-09-04T00:00:00.001Z' }, now)).toBe(false)
  })

  it('is true exactly at the deadline', () => {
    expect(isPastPurgeDeadline({ purgeAfter: '2026-09-04T00:00:00.000Z' }, now)).toBe(true)
  })

  it('is true past the deadline', () => {
    expect(isPastPurgeDeadline({ purgeAfter: '2026-09-03T00:00:00.000Z' }, now)).toBe(true)
  })
})

const makeStore = (
  templates: Array<{ id: string; data: Record<string, unknown> }>,
  runs: Array<{ id: string; data: Record<string, unknown> }>,
  purgeResource: ScheduledPurgeStore['purgeResource'],
): ScheduledPurgeStore => ({
  listCollectionDocs: async (collection) => (collection === 'lessonTemplates' ? templates : runs),
  purgeResource,
})

describe('purgeExpiredSoftDeletes', () => {
  const now = () => new Date('2026-09-04T00:00:00.000Z')

  it('does not purge a document whose purgeAfter has not yet arrived', async () => {
    const purgeResource = vi.fn().mockResolvedValue(undefined)
    const store = makeStore(
      [],
      [{ id: 'run-not-due', data: { pendingDeletion: { purgeAfter: '2026-09-05T00:00:00.000Z' } } }],
      purgeResource,
    )
    const result = await purgeExpiredSoftDeletes({ store, now })
    expect(purgeResource).not.toHaveBeenCalled()
    expect(result).toEqual({ purged: [], failed: [] })
  })

  it('purges a document exactly at its purgeAfter deadline', async () => {
    const purgeResource = vi.fn().mockResolvedValue(undefined)
    const store = makeStore(
      [],
      [{ id: 'run-due', data: { pendingDeletion: { purgeAfter: '2026-09-04T00:00:00.000Z' } } }],
      purgeResource,
    )
    const result = await purgeExpiredSoftDeletes({ store, now })
    expect(purgeResource).toHaveBeenCalledWith('lessonRuns', 'run-due')
    expect(result).toEqual({ purged: ['lessonRuns/run-due'], failed: [] })
  })

  it('ignores a document with no pendingDeletion at all', async () => {
    const purgeResource = vi.fn().mockResolvedValue(undefined)
    const store = makeStore([{ id: 'template-active', data: {} }], [], purgeResource)
    const result = await purgeExpiredSoftDeletes({ store, now })
    expect(purgeResource).not.toHaveBeenCalled()
    expect(result).toEqual({ purged: [], failed: [] })
  })

  it('continues processing remaining documents when one fails, recording the failure rather than aborting the run', async () => {
    const purgeResource = vi.fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined)
    const store = makeStore(
      [{ id: 'template-due', data: { pendingDeletion: { purgeAfter: '2026-09-01T00:00:00.000Z' } } }],
      [{ id: 'run-due', data: { pendingDeletion: { purgeAfter: '2026-09-01T00:00:00.000Z' } } }],
      purgeResource,
    )
    const onFailure = vi.fn()
    const result = await purgeExpiredSoftDeletes({ store, now, onFailure })
    expect(purgeResource).toHaveBeenCalledTimes(2)
    expect(result.purged).toEqual(['lessonRuns/run-due'])
    expect(result.failed).toEqual(['lessonTemplates/template-due'])
    expect(onFailure).toHaveBeenCalledWith('lessonTemplates/template-due', expect.any(Error))
  })

  it('purges both templates and runs due in the same sweep', async () => {
    const purgeResource = vi.fn().mockResolvedValue(undefined)
    const store = makeStore(
      [{ id: 't1', data: { pendingDeletion: { purgeAfter: '2026-09-01T00:00:00.000Z' } } }],
      [{ id: 'r1', data: { pendingDeletion: { purgeAfter: '2026-09-01T00:00:00.000Z' } } }],
      purgeResource,
    )
    const result = await purgeExpiredSoftDeletes({ store, now })
    expect(result.purged.sort()).toEqual(['lessonRuns/r1', 'lessonTemplates/t1'])
  })

  it('re-running for a document already fully purged (no longer listed) is a safe no-op, not an error', async () => {
    const purgeResource = vi.fn().mockResolvedValue(undefined)
    // First run: the due doc is listed and purged.
    const firstRunStore = makeStore(
      [],
      [{ id: 'run-1', data: { pendingDeletion: { purgeAfter: '2026-09-01T00:00:00.000Z' } } }],
      purgeResource,
    )
    const firstResult = await purgeExpiredSoftDeletes({ store: firstRunStore, now })
    expect(firstResult).toEqual({ purged: ['lessonRuns/run-1'], failed: [] })

    // Second run: the doc is truly gone now, so the live listing no longer
    // returns it — the sweep must not error or re-attempt anything for it.
    const secondRunStore = makeStore([], [], purgeResource)
    const secondResult = await purgeExpiredSoftDeletes({ store: secondRunStore, now })
    expect(purgeResource).toHaveBeenCalledTimes(1)
    expect(secondResult).toEqual({ purged: [], failed: [] })
  })
})
