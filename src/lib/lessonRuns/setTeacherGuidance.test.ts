import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { setTeacherGuidance } from './setTeacherGuidance'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('setTeacherGuidance', () => it('calls the callable', async () => { const call = vi.fn().mockResolvedValue({ data: { teacherGuidance: '説明' } }); vi.mocked(httpsCallable).mockReturnValue(call as never); await expect(setTeacherGuidance({} as never, { lessonRunId: 'r', teacherGuidance: '説明' })).resolves.toEqual({ teacherGuidance: '説明' }) }))
