import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { searchOrgStudentData, type SearchOrgStudentDataInput } from './orgStudentDataSearch'

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}))

describe('searchOrgStudentData', () => {
  it('calls searchOrgStudentDataCallable with the exact payload and returns response data', async () => {
    const fakeResult = {
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [
        {
          lessonRunId: 'run-1',
          participantId: 'p-1',
          displayName: '山田 太郎',
        },
      ],
    }

    const callableFn = vi.fn().mockResolvedValue({ data: fakeResult })
    vi.mocked(httpsCallable).mockReturnValue(callableFn as never)

    const fakeFunctions = {} as never
    const input: SearchOrgStudentDataInput = {
      orgId: 'school-1',
      field: 'displayName',
      query: '山田 太郎',
      reason: '学籍確認のため',
    }

    const result = await searchOrgStudentData(fakeFunctions, input)

    expect(httpsCallable).toHaveBeenCalledWith(fakeFunctions, 'searchOrgStudentDataCallable')
    expect(callableFn).toHaveBeenCalledWith(input)
    expect(result).toEqual(fakeResult)
  })
})
