import { describe, expect, it, vi, beforeEach } from 'vitest'

const queryResults = new Map<string, Record<string, unknown>[]>()
const queryCalls: string[] = []

const collection = (path: string) => ({
  where: () => ({ get: async () => { queryCalls.push(path); return { docs: (queryResults.get(path) ?? []).map((data, i) => ({ id: `${path}-${i}`, data: () => data })) } } }),
  get: async () => { queryCalls.push(path); return { docs: (queryResults.get(path) ?? []).map((data, i) => ({ id: `${path}-${i}`, data: () => data })) } },
})

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection }) }))

import { exportOrgStudentDataWithAdminSdk } from './exportOrgStudentData'

describe('exportOrgStudentDataWithAdminSdk', () => {
  beforeEach(() => { queryResults.clear(); queryCalls.length = 0 })

  it('queries lessonRuns filtered by orgId and each sub-collection by lessonRunId', async () => {
    queryResults.set('lessonRuns', [{ id: 'run-1' }])
    queryResults.set('lessonRuns/lessonRuns-0/participants', [{ displayName: '生徒A' }])
    queryResults.set('lessonRuns/lessonRuns-0/households', [])

    const result = await exportOrgStudentDataWithAdminSdk('school-1')

    expect(queryCalls).toContain('lessonRuns')
    expect(result.orgId).toBe('school-1')
    expect(result.lessonRuns).toHaveLength(1)
  })

  it('returns an empty export when the org has no lesson runs', async () => {
    const result = await exportOrgStudentDataWithAdminSdk('school-empty')
    expect(result.lessonRuns).toEqual([])
  })
})
