import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { generateTeacherGuidance } from './generateTeacherGuidance'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('generateTeacherGuidance', () => it('calls the callable', async () => { const call = vi.fn().mockResolvedValue({ data: { teacherGuidance: '説明' } }); vi.mocked(httpsCallable).mockReturnValue(call as never); await expect(generateTeacherGuidance({} as never, { topic: '株価' })).resolves.toEqual({ teacherGuidance: '説明' }); expect(call).toHaveBeenCalledWith({ topic: '株価' }) }))
