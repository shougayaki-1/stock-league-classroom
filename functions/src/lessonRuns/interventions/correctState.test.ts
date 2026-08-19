import { describe, expect, it } from 'vitest'
import { correctState } from './correctState'

const buildDeps = () => {
  const updates: Array<{ path: string; patch: Record<string, unknown> }> = []
  const published: string[] = []
  return {
    updates,
    published,
    deps: {
      updateDoc: async (path: string, patch: Record<string, unknown>) => { updates.push({ path, patch }) },
      publishLessonProjection: async (id: string) => { published.push(id) },
    },
  }
}

describe('correctState', () => {
  it('参加者の表示名を直す', async () => {
    const { deps, updates } = buildDeps()

    await correctState(deps, {
      lessonRunId: 'run1',
      target: 'PARTICIPANT_DISPLAY_NAME',
      targetId: 'p1',
      displayName: '山田 太郎',
    })

    expect(updates).toEqual([
      { path: 'lessonRuns/run1/participants/p1', patch: { displayName: '山田 太郎' } },
    ])
  })

  it('チーム名を直す', async () => {
    const { deps, updates } = buildDeps()

    await correctState(deps, {
      lessonRunId: 'run1',
      target: 'TEAM_DISPLAY_NAME',
      targetId: 'team-a',
      displayName: 'Aチーム',
    })

    expect(updates).toEqual([
      { path: 'lessonRuns/run1/teams/team-a', patch: { displayName: 'Aチーム' } },
    ])
  })

  it('チーム名の変更後に教室表示を発行する', async () => {
    const { deps, published } = buildDeps()
    await correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'Aチーム' })
    expect(published).toEqual(['run1'])
  })

  it('参加者名の変更では教室表示を発行しない', async () => {
    const { deps, published } = buildDeps()
    await correctState(deps, { lessonRunId: 'run1', target: 'PARTICIPANT_DISPLAY_NAME', targetId: 'p1', displayName: '山田' })
    expect(published).toEqual([])
  })

  it('許可リストに無い target を拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      correctState(deps, { lessonRunId: 'run1', target: 'RANDOM_SEED' as never, targetId: 'x', displayName: 'y' }),
    ).rejects.toThrow('Unsupported correction target')
  })

  it('空の表示名を拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: '   ' }),
    ).rejects.toThrow('displayName must be 1 to 50 characters')
  })

  it('51文字以上の表示名を拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'あ'.repeat(51) }),
    ).rejects.toThrow('displayName must be 1 to 50 characters')
  })

  it('表示名の前後空白を除く', async () => {
    const { deps, updates } = buildDeps()
    await correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: '  Aチーム  ' })
    expect(updates[0].patch.displayName).toBe('Aチーム')
  })
})
