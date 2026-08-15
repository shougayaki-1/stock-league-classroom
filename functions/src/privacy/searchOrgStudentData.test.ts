import { describe, expect, it, vi } from 'vitest'
import {
  searchOrgStudentData,
  type SearchOrgStudentDataDeps,
} from './searchOrgStudentData'

describe('searchOrgStudentData', () => {
  const FIXED_NOW = new Date('2026-08-15T12:00:00.000Z')
  const now = () => FIXED_NOW

  it('allows owner to search all lesson runs in the organization', async () => {
    const listLessonRuns = vi.fn().mockResolvedValue([
      { id: 'run-1', orgId: 'org-1' },
      { id: 'run-2', orgId: 'org-1', teacherRoles: { 'teacher-b': 'PRIMARY' } },
    ])
    const findParticipants = vi.fn().mockImplementation(async (runId: string) => {
      if (runId === 'run-1') {
        return [
          {
            id: 'p-1',
            lessonRunId: 'run-1',
            displayName: '山田 太郎',
            authUid: 'uid-1',
            identityMode: 'ANONYMOUS',
            teamId: 'team-1',
            status: 'ACTIVE',
            extraUnwantedField: 'secret-1',
          },
        ]
      }
      return []
    })

    const deps: SearchOrgStudentDataDeps = {
      orgId: 'org-1',
      actorUid: 'owner-uid',
      actorRole: 'owner',
      field: 'displayName',
      query: '山田 太郎',
      listLessonRuns,
      findParticipants,
      now,
    }

    const result = await searchOrgStudentData(deps)

    expect(listLessonRuns).toHaveBeenCalledTimes(1)
    expect(findParticipants).toHaveBeenCalledWith('run-1', 'displayName', '山田 太郎')
    expect(findParticipants).toHaveBeenCalledWith('run-2', 'displayName', '山田 太郎')
    expect(result).toEqual({
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [
        {
          lessonRunId: 'run-1',
          participantId: 'p-1',
          displayName: '山田 太郎',
          authUid: 'uid-1',
          identityMode: 'ANONYMOUS',
          teamId: 'team-1',
          status: 'ACTIVE',
        },
      ],
    })
    expect((result.matches[0] as unknown as Record<string, unknown>).extraUnwantedField).toBeUndefined()
  })

  it('restricts admin to only lesson runs where actorUid is in teacherRoles', async () => {
    const listLessonRuns = vi.fn().mockResolvedValue([
      { id: 'run-1', orgId: 'org-1', teacherRoles: { 'admin-uid': 'PRIMARY' } },
      { id: 'run-2', orgId: 'org-1', teacherRoles: { 'other-teacher': 'PRIMARY' } },
      { id: 'run-3', orgId: 'org-1', teacherRoles: { 'admin-uid': 'ASSISTANT' } },
      { id: 'run-4', orgId: 'org-1' }, // no teacherRoles
    ])
    const findParticipants = vi.fn().mockImplementation(async (runId: string) => {
      if (runId === 'run-1') {
        return [{ id: 'p-1', displayName: '佐藤 花子', status: 'ACTIVE' }]
      }
      if (runId === 'run-3') {
        return [{ id: 'p-3', displayName: '佐藤 花子', status: 'COMPLETED' }]
      }
      return []
    })

    const deps: SearchOrgStudentDataDeps = {
      orgId: 'org-1',
      actorUid: 'admin-uid',
      actorRole: 'admin',
      field: 'displayName',
      query: '佐藤 花子',
      listLessonRuns,
      findParticipants,
      now,
    }

    const result = await searchOrgStudentData(deps)

    expect(findParticipants).toHaveBeenCalledTimes(2)
    expect(findParticipants).toHaveBeenCalledWith('run-1', 'displayName', '佐藤 花子')
    expect(findParticipants).toHaveBeenCalledWith('run-3', 'displayName', '佐藤 花子')
    expect(findParticipants).not.toHaveBeenCalledWith('run-2', expect.anything(), expect.anything())
    expect(findParticipants).not.toHaveBeenCalledWith('run-4', expect.anything(), expect.anything())

    expect(result.matches).toEqual([
      {
        lessonRunId: 'run-1',
        participantId: 'p-1',
        displayName: '佐藤 花子',
        status: 'ACTIVE',
      },
      {
        lessonRunId: 'run-3',
        participantId: 'p-3',
        displayName: '佐藤 花子',
        status: 'COMPLETED',
      },
    ])
  })

  it('searches by externalIdentifier exact match', async () => {
    const listLessonRuns = vi.fn().mockResolvedValue([
      { id: 'run-1', orgId: 'org-1' },
    ])
    const findParticipants = vi.fn().mockResolvedValue([
      { id: 'p-10', externalIdentifier: 'STUDENT-999', displayName: 'テスト生徒' },
    ])

    const deps: SearchOrgStudentDataDeps = {
      orgId: 'org-1',
      actorUid: 'owner-uid',
      actorRole: 'owner',
      field: 'externalIdentifier',
      query: 'STUDENT-999',
      listLessonRuns,
      findParticipants,
      now,
    }

    const result = await searchOrgStudentData(deps)

    expect(findParticipants).toHaveBeenCalledWith('run-1', 'externalIdentifier', 'STUDENT-999')
    expect(result.matches).toEqual([
      {
        lessonRunId: 'run-1',
        participantId: 'p-10',
        externalIdentifier: 'STUDENT-999',
        displayName: 'テスト生徒',
      },
    ])
  })

  it('caps matches at 50 and sets truncated to true when count exceeds 50', async () => {
    const listLessonRuns = vi.fn().mockResolvedValue([
      { id: 'run-1', orgId: 'org-1' },
      { id: 'run-2', orgId: 'org-1' },
    ])
    // run-1 produces 30 matches, run-2 produces 25 matches -> total 55 matches
    const run1Participants = Array.from({ length: 30 }, (_, i) => ({
      id: `p-run1-${i}`,
      displayName: '同姓同名',
    }))
    const run2Participants = Array.from({ length: 25 }, (_, i) => ({
      id: `p-run2-${i}`,
      displayName: '同姓同名',
    }))

    const findParticipants = vi.fn().mockImplementation(async (runId: string) => {
      if (runId === 'run-1') return run1Participants
      if (runId === 'run-2') return run2Participants
      return []
    })

    const deps: SearchOrgStudentDataDeps = {
      orgId: 'org-1',
      actorUid: 'owner-uid',
      actorRole: 'owner',
      field: 'displayName',
      query: '同姓同名',
      listLessonRuns,
      findParticipants,
      now,
    }

    const result = await searchOrgStudentData(deps)

    expect(result.matches).toHaveLength(50)
    expect(result.truncated).toBe(true)
    expect(result.matches[0].participantId).toBe('p-run1-0')
    expect(result.matches[49].participantId).toBe('p-run2-19')
  })

  it('sets truncated to false when matches are 50 or fewer', async () => {
    const listLessonRuns = vi.fn().mockResolvedValue([
      { id: 'run-1', orgId: 'org-1' },
    ])
    const participants = Array.from({ length: 50 }, (_, i) => ({
      id: `p-${i}`,
      displayName: '同姓同名',
    }))

    const findParticipants = vi.fn().mockResolvedValue(participants)

    const deps: SearchOrgStudentDataDeps = {
      orgId: 'org-1',
      actorUid: 'owner-uid',
      actorRole: 'owner',
      field: 'displayName',
      query: '同姓同名',
      listLessonRuns,
      findParticipants,
      now,
    }

    const result = await searchOrgStudentData(deps)

    expect(result.matches).toHaveLength(50)
    expect(result.truncated).toBe(false)
  })

  it('returns expiresAt 10 minutes in the future', async () => {
    const listLessonRuns = vi.fn().mockResolvedValue([])
    const findParticipants = vi.fn().mockResolvedValue([])

    const result = await searchOrgStudentData({
      orgId: 'org-1',
      actorUid: 'owner-uid',
      actorRole: 'owner',
      field: 'displayName',
      query: '誰もいない',
      listLessonRuns,
      findParticipants,
      now: () => new Date('2026-08-15T00:00:00.000Z'),
    })

    expect(result.expiresAt).toBe('2026-08-15T00:10:00.000Z')
    expect(result.matches).toEqual([])
    expect(result.truncated).toBe(false)
  })
})
