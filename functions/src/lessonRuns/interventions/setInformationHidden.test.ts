import { describe, expect, it } from 'vitest'
import { setInformationHidden } from './setInformationHidden'

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
      publishResearchDeskProjection: async (id: string) => { published.push(id) },
    },
  }
}

describe('setInformationHidden', () => {
  it('非表示リストに追加する', async () => {
    const { deps, writes } = buildDeps({ orgId: 'org1', hiddenInformationIds: ['info-1'] })

    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-2', hidden: true })

    expect(result.hiddenInformationIds).toEqual(['info-1', 'info-2'])
    expect(writes[0].data.hiddenInformationIds).toEqual(['info-1', 'info-2'])
  })

  it('同じ id を二重に追加しない', async () => {
    const { deps } = buildDeps({ orgId: 'org1', hiddenInformationIds: ['info-1'] })
    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: true })
    expect(result.hiddenInformationIds).toEqual(['info-1'])
  })

  it('非表示リストから除去して再表示する', async () => {
    const { deps } = buildDeps({ orgId: 'org1', hiddenInformationIds: ['info-1', 'info-2'] })
    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: false })
    expect(result.hiddenInformationIds).toEqual(['info-2'])
  })

  it('リストが未設定でも追加できる', async () => {
    const { deps } = buildDeps({ orgId: 'org1' })
    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: true })
    expect(result.hiddenInformationIds).toEqual(['info-1'])
  })

  it('書き込み後に research desk を発行する', async () => {
    const { deps, published } = buildDeps({ orgId: 'org1' })
    await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: true })
    expect(published).toEqual(['run1'])
  })
})
