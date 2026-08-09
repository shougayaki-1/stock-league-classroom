import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { generateLessonDraft } from './generateLessonDraft'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('generateLessonDraft', () => it('calls generateLessonDraftCallable with the input and returns its data', async () => { const call = vi.fn().mockResolvedValue({ data: { title: 'AI案', description: '説明' } }); vi.mocked(httpsCallable).mockReturnValue(call as never); const input = { theme: 'テーマ', mainObjective: '目標', subject: 'SOCIAL_STUDIES' as const, difficulty: 'STANDARD' as const }; await expect(generateLessonDraft({} as never, input)).resolves.toEqual({ title: 'AI案', description: '説明' }); expect(httpsCallable).toHaveBeenCalledWith({}, 'generateLessonDraftCallable'); expect(call).toHaveBeenCalledWith(input) }))
