import { describe, expect, it } from 'vitest'
import { buildLessonDraftPrompt, parseLessonDraftResponse } from './lessonDraftPrompt'
describe('lesson draft prompt', () => {
  it('includes teacher input and requests a JSON title and description', () => { const prompt = buildLessonDraftPrompt({ theme: '身近な企業', mainObjective: '需給を学ぶ', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD' }); expect(prompt).toContain('身近な企業'); expect(prompt).toContain('需給を学ぶ'); expect(prompt).toContain('JSON') })
  it('parses only a title and description JSON object', () => {
    expect(parseLessonDraftResponse('{"title":"AI教材","description":"説明"}')).toEqual({ title: 'AI教材', description: '説明' })
    expect(() => parseLessonDraftResponse('not json')).toThrow('AI response was not valid JSON')
    expect(() => parseLessonDraftResponse('{"title":123}')).toThrow('AI response is missing required field: title')
  })
})
