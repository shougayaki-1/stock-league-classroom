import { describe, expect, it } from 'vitest'
import { exportPersonalData } from './exportPersonalData'

describe('exportPersonalData', () => {
  it('collects every lessonTemplate, its versions, and every lessonRun owned by the org, keyed for a JSON download', async () => {
    const templates = [{ id: 't1', orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: {} }]
    const versions = { t1: [{ id: 'v1', templateId: 't1' }] }
    const runs = [{ id: 'r1', orgId: 'personal_teacher-a', templateId: 't1' }]
    const events = { r1: [{ eventId: 'e1', sequence: 0 }] }
    const checkpoints = { r1: [{ id: 'c1', sequence: 0 }] }
    const result = await exportPersonalData({
      uid: 'teacher-a',
      orgId: 'personal_teacher-a',
      getUser: async () => ({ id: 'teacher-a', displayName: 'Teacher A' }),
      getOrganization: async () => ({ id: 'personal_teacher-a', type: 'personal' }),
      getMembership: async () => ({ uid: 'teacher-a', role: 'owner', status: 'active' }),
      getOrgAccessMirror: async () => ({ role: 'owner', status: 'active', membershipVersion: 1 }),
      getOrgAccessMeta: async () => ({ membershipVersion: 1, syncState: 'SYNCED' }),
      listLessonTemplates: async () => templates,
      listLessonVersions: async (templateId: string) => versions[templateId as keyof typeof versions] ?? [],
      listLessonRuns: async () => runs,
      listLessonEvents: async (lessonRunId: string) => events[lessonRunId as keyof typeof events] ?? [],
      listLessonCheckpoints: async (lessonRunId: string) => checkpoints[lessonRunId as keyof typeof checkpoints] ?? [],
    })
    expect(result).toEqual({
      exportedAt: expect.any(String),
      uid: 'teacher-a',
      orgId: 'personal_teacher-a',
      user: { id: 'teacher-a', displayName: 'Teacher A' },
      organization: { id: 'personal_teacher-a', type: 'personal' },
      membership: { uid: 'teacher-a', role: 'owner', status: 'active' },
      orgAccessMirror: { role: 'owner', status: 'active', membershipVersion: 1 },
      orgAccessMeta: { membershipVersion: 1, syncState: 'SYNCED' },
      lessonTemplates: [{ ...templates[0], versions: versions.t1 }],
      lessonRuns: [{ ...runs[0], events: events.r1, checkpoints: checkpoints.r1 }],
    })
  })
})
