import { describe, expect, it } from 'vitest'
import { extendPhaseTimer } from './extendPhaseTimer'

const buildDeps = (run: Record<string, unknown>) => {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const published: string[] = []
  return {
    writes,
    published,
    deps: {
      firestore: {
        runTransaction: async <T>(fn: (tx: {
          get: (path: string) => Promise<{ exists: boolean; data: () => unknown }>
          set: (path: string, data: Record<string, unknown>) => void
        }) => Promise<T>): Promise<T> => fn({
          get: async () => ({ exists: true, data: () => run }),
          set: (path, data) => { writes.push({ path, data }) },
        }),
      },
      publishLessonProjection: async (id: string) => { published.push(id) },
    },
  }
}

const run = {
  orgId: 'org1',
  status: 'RUNNING',
  currentPhaseId: 'phase-market',
  currentPhaseEndsAtMillis: 1_700_000_060_000,
}

describe('extendPhaseTimer', () => {
  it('現在フェーズの終了時刻に加算する', async () => {
    const { deps, writes } = buildDeps(run)

    const result = await extendPhaseTimer(deps, {
      lessonRunId: 'run1',
      phaseId: 'phase-market',
      additionalSeconds: 180,
    })

    expect(result.currentPhaseEndsAtMillis).toBe(1_700_000_060_000 + 180_000)
    expect(writes[0].path).toBe('lessonRuns/run1')
    expect(writes[0].data.currentPhaseEndsAtMillis).toBe(1_700_000_060_000 + 180_000)
  })

  it('加算後に教室表示を発行する', async () => {
    const { deps, published } = buildDeps(run)
    await extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 60 })
    expect(published).toEqual(['run1'])
  })

  it('現在フェーズと一致しない phaseId を拒否する', async () => {
    const { deps } = buildDeps(run)
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-intro', additionalSeconds: 60 }),
    ).rejects.toThrow('Phase is no longer current')
  })

  it('制限時間の無いフェーズを拒否する', async () => {
    const { deps } = buildDeps({ ...run, currentPhaseEndsAtMillis: null })
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 60 }),
    ).rejects.toThrow('Phase has no timer')
  })

  it('0以下の秒数を拒否する', async () => {
    const { deps } = buildDeps(run)
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 0 }),
    ).rejects.toThrow('additionalSeconds must be between 1 and 1800')
  })

  it('上限を超える秒数を拒否する', async () => {
    const { deps } = buildDeps(run)
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 1801 }),
    ).rejects.toThrow('additionalSeconds must be between 1 and 1800')
  })
})
