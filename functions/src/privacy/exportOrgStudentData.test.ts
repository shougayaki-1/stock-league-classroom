import { describe, expect, it, vi } from 'vitest'
import { exportOrgStudentData, type ExportOrgStudentDataDeps } from './exportOrgStudentData'

const makeDeps = (overrides: Partial<ExportOrgStudentDataDeps> = {}): ExportOrgStudentDataDeps => ({
  orgId: 'school-1',
  listLessonRuns: vi.fn().mockResolvedValue([{ id: 'run-1', status: 'COMPLETED' }]),
  listParticipants: vi.fn().mockResolvedValue([{ id: 'p1', displayName: '生徒A' }]),
  listTeamAccounts: vi.fn().mockResolvedValue([{ id: 'team-1', cash: 10000 }]),
  listOrders: vi.fn().mockResolvedValue([{ id: 'o1', side: 'BUY' }]),
  listHouseholds: vi.fn().mockResolvedValue([{ id: 'h1', name: '家計1' }]),
  listHouseholdDecisions: vi.fn().mockResolvedValue([{ id: 'd1', choice: 'SAVE' }]),
  now: () => '2026-08-15T00:00:00.000Z',
  ...overrides,
})

describe('exportOrgStudentData', () => {
  it('assembles participants/teamAccounts/orders/households(+decisions) for every lesson run', async () => {
    const deps = makeDeps()
    await expect(exportOrgStudentData(deps)).resolves.toEqual({
      exportedAt: '2026-08-15T00:00:00.000Z',
      orgId: 'school-1',
      lessonRuns: [{
        id: 'run-1', status: 'COMPLETED',
        participants: [{ id: 'p1', displayName: '生徒A' }],
        teamAccounts: [{ id: 'team-1', cash: 10000 }],
        orders: [{ id: 'o1', side: 'BUY' }],
        households: [{ id: 'h1', name: '家計1', decisions: [{ id: 'd1', choice: 'SAVE' }] }],
      }],
    })
  })

  it('calls each sub-collection getter with the lesson run id', async () => {
    const deps = makeDeps()
    await exportOrgStudentData(deps)
    expect(deps.listParticipants).toHaveBeenCalledWith('run-1')
    expect(deps.listTeamAccounts).toHaveBeenCalledWith('run-1')
    expect(deps.listOrders).toHaveBeenCalledWith('run-1')
    expect(deps.listHouseholds).toHaveBeenCalledWith('run-1')
  })

  it('calls listHouseholdDecisions with both the lesson run id and the household id', async () => {
    const deps = makeDeps()
    await exportOrgStudentData(deps)
    expect(deps.listHouseholdDecisions).toHaveBeenCalledWith('run-1', 'h1')
  })

  it('returns an empty lessonRuns array when the org has no lesson runs', async () => {
    const deps = makeDeps({ listLessonRuns: vi.fn().mockResolvedValue([]) })
    await expect(exportOrgStudentData(deps)).resolves.toMatchObject({ lessonRuns: [] })
    expect(deps.listParticipants).not.toHaveBeenCalled()
  })
})
