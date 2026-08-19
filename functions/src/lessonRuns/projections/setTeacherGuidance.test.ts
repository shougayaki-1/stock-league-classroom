import { describe, expect, it } from 'vitest'
import { setTeacherGuidance } from './setTeacherGuidance'

const buildDeps = (overrides: Partial<Record<string, unknown>> = {}) => {
  const runDoc: Record<string, unknown> = {
    orgId: 'org1',
    status: 'RUNNING',
    currentPhaseId: null,
    templateSnapshot: { title: '授業タイトル' },
    ...overrides,
  }
  const updated: Array<{ id: string; patch: unknown }> = []
  const published: Array<{ id: string; state: unknown }> = []
  return {
    deps: {
      updateRun: async (id: string, patch: unknown) => {
        updated.push({ id, patch })
        Object.assign(runDoc, patch as Record<string, unknown>)
      },
      source: {
        getRun: async () => runDoc,
        getTeams: async () => [{ id: 'team-a', displayName: 'Aチーム' }],
      },
      setDisplayState: async (id: string, state: unknown) => { published.push({ id, state }) },
      now: () => 1_700_000_000_000,
    },
    updated,
    published,
  }
}

describe('setTeacherGuidance', () => {
  it('writes Firestore and RTDB display state', async () => {
    const { deps, updated, published } = buildDeps()
    await setTeacherGuidance(deps, { lessonRunId: 'run-1', teacherGuidance: '説明' })

    expect(updated).toEqual([{ id: 'run-1', patch: { teacherGuidance: '説明' } }])
    expect(published).toHaveLength(1)
    expect(published[0]).toEqual({
      id: 'run-1',
      state: expect.objectContaining({
        mode: 'LIVE',
        title: '授業タイトル',
        teacherGuidance: '説明',
        updatedAtMillis: 1_700_000_000_000,
      }),
    })
  })

  it('normalizes empty string to null', async () => {
    const { deps, updated } = buildDeps()
    const result = await setTeacherGuidance(deps, { lessonRunId: 'run-1', teacherGuidance: '' })

    expect(updated).toEqual([{ id: 'run-1', patch: { teacherGuidance: null } }])
    expect(result.teacherGuidance).toBeNull()
  })
})
