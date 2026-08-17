import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import type { Functions } from 'firebase/functions'
import { generateLessonResult, getMyLessonResult } from './results'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('generateLessonResult', () => {
  it('calls generateLessonResultCallable with the given input', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { resultId: 'result-1', deduplicated: false } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const functions = {} as Functions
    const result = await generateLessonResult(functions, { lessonRunId: 'run-1', phaseId: 'phase-1', idempotencyKey: 'idem-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'generateLessonResultCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', phaseId: 'phase-1', idempotencyKey: 'idem-1' })
    expect(result).toEqual({ resultId: 'result-1', deduplicated: false })
  })
})

describe('getMyLessonResult', () => {
  it('calls getMyLessonResultCallable with the lessonRunId', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { found: true, lessonRunId: 'run-1', items: [] } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const functions = {} as Functions
    const result = await getMyLessonResult(functions, { lessonRunId: 'run-1' })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getMyLessonResultCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
    expect(result).toEqual({ found: true, lessonRunId: 'run-1', items: [] })
  })
})
