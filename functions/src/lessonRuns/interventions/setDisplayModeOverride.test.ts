import { describe, expect, it } from 'vitest'
import { setDisplayModeOverride } from './setDisplayModeOverride'

const buildDeps = () => {
  const updates: Array<{ path: string; patch: Record<string, unknown> }> = []
  const published: string[] = []
  return {
    updates,
    published,
    deps: {
      updateRun: async (path: string, patch: Record<string, unknown>) => { updates.push({ path, patch }) },
      publishLessonProjection: async (id: string) => { published.push(id) },
    },
  }
}

describe('setDisplayModeOverride', () => {
  it('指定されたモードを lessonRun に書く', async () => {
    const { deps, updates } = buildDeps()

    const result = await setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: 'EXPLANATION' })

    expect(result.displayModeOverride).toBe('EXPLANATION')
    expect(updates).toEqual([{ path: 'lessonRuns/run1', patch: { displayModeOverride: 'EXPLANATION' } }])
  })

  it('null で自動導出に戻す', async () => {
    const { deps, updates } = buildDeps()

    const result = await setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: null })

    expect(result.displayModeOverride).toBeNull()
    expect(updates).toEqual([{ path: 'lessonRuns/run1', patch: { displayModeOverride: null } }])
  })

  it('書き込み後に教室表示を発行する', async () => {
    const { deps, published } = buildDeps()
    await setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: 'END' })
    expect(published).toEqual(['run1'])
  })

  it('未知のモードを拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: 'NOPE' as never }),
    ).rejects.toThrow('Unknown display mode')
  })
})
