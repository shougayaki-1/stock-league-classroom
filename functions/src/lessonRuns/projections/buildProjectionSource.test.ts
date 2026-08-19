import { describe, expect, it } from 'vitest'
import { buildProjectionSource } from './buildProjectionSource'

const run = {
  orgId: 'org1',
  status: 'RUNNING',
  currentPhaseId: 'phase-market',
  currentPhaseEndsAtMillis: 1_700_000_060_000,
  teacherGuidance: 'いまは値動きを見てください',
  templateSnapshot: {
    title: '市場のしくみを学ぶ',
    description: '需給と情報で価格が動くことを体験する',
    phases: [
      { id: 'phase-intro', publicTask: '説明を聞きます' },
      { id: 'phase-market', publicTask: '売買の判断をします' },
    ],
  },
  randomSeed: 'SECRET-SEED',
  restoreGeneration: 3,
  future: { prices: [1, 2, 3] },
}

const teams = [
  { id: 'team-a', displayName: 'Aチーム' },
  { id: 'team-b', displayName: 'Bチーム' },
]

const deps = {
  getRun: async () => run as Record<string, unknown>,
  getTeams: async () => teams as Array<Record<string, unknown>>,
  now: () => 1_700_000_000_000,
}

describe('buildProjectionSource', () => {
  it('lessonRun doc と teams から source を組み立てる', async () => {
    const source = await buildProjectionSource(deps, 'run1')

    expect(source).not.toBeNull()
    expect(source?.orgId).toBe('org1')
    expect(source?.status).toBe('RUNNING')
    expect(source?.title).toBe('市場のしくみを学ぶ')
    expect(source?.goal).toBe('需給と情報で価格が動くことを体験する')
    expect(source?.currentPhaseId).toBe('phase-market')
    expect(source?.currentPhaseEndsAtMillis).toBe(1_700_000_060_000)
    expect(source?.teacherGuidance).toBe('いまは値動きを見てください')
    expect(source?.updatedAtMillis).toBe(1_700_000_000_000)
  })

  it('現在フェーズの publicTask を引く', async () => {
    const source = await buildProjectionSource(deps, 'run1')
    expect(source?.currentPhasePublicTask).toBe('売買の判断をします')
  })

  it('teams を id と displayName に写す', async () => {
    const source = await buildProjectionSource(deps, 'run1')
    expect(source?.teams).toEqual([
      { id: 'team-a', displayName: 'Aチーム', publicAggregateLabel: null },
      { id: 'team-b', displayName: 'Bチーム', publicAggregateLabel: null },
    ])
  })

  it('禁止フィールドを source に載せない', async () => {
    const source = await buildProjectionSource(deps, 'run1')
    expect(source).not.toHaveProperty('randomSeed', 'SECRET-SEED')
    expect(source?.future).toBeUndefined()
  })

  it('lessonRun が無ければ null を返す', async () => {
    const source = await buildProjectionSource(
      { ...deps, getRun: async () => null },
      'missing',
    )
    expect(source).toBeNull()
  })
})
